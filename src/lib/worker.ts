import type { SyncJob } from "@prisma/client";
import { prisma } from "./db";
import { backoffMs } from "./jobs";
import { archiveClaim, syncBatch, syncClaimToSheet } from "./archive";
import { sendEmail } from "./email";
import { runReminders } from "./reminders";
import { runDailyBackup } from "./backup";

/** Claim up to `limit` due jobs atomically (safe with several workers). */
async function claimJobs(limit: number): Promise<SyncJob[]> {
  return prisma.$queryRaw<SyncJob[]>`
    UPDATE "SyncJob" SET status = 'RUNNING', attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "SyncJob" WHERE status = 'QUEUED' AND "runAfter" <= now()
      ORDER BY "runAfter" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

async function runJob(job: SyncJob) {
  const p = job.payload as Record<string, string>;
  switch (job.kind) {
    case "ARCHIVE_CLAIM":
      return archiveClaim(p.claimId);
    case "SHEETS_SYNC_CLAIM":
      return syncClaimToSheet(p.claimId);
    case "SHEETS_SYNC_BATCH":
      return syncBatch(p.batchId);
    case "EMAIL": {
      const n = await prisma.notification.findUnique({ where: { id: p.notificationId }, include: { user: true } });
      if (!n || n.emailedAt) return;
      const base = process.env.APP_URL || process.env.NEXTAUTH_URL || "";
      const r = await sendEmail(n.user.email, `[Staff Claims] ${n.title}`, `${n.body}\n\n${n.link ? base + n.link : ""}\n\nThis is an automated message from the Staff Claims system.`);
      if (!r.skipped) await prisma.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
      return;
    }
    default:
      throw new Error(`Unknown job kind ${job.kind}`);
  }
}

export async function processDueJobs(limit = 10) {
  const jobs = await claimJobs(limit);
  let ok = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await runJob(job);
      // A job re-enqueued while running (dedupe reset to QUEUED) must not be marked DONE.
      await prisma.syncJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "DONE", lastError: null } });
      ok++;
    } catch (e) {
      failed++;
      const msg = String((e as Error)?.message ?? e).slice(0, 1000);
      const final = job.attempts >= job.maxAttempts;
      await prisma.syncJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: { status: final ? "FAILED" : "QUEUED", lastError: msg, runAfter: new Date(Date.now() + backoffMs(job.attempts)) },
      });
      console.error(`[worker] ${job.kind} ${job.id} attempt ${job.attempts} failed: ${msg}`);
    }
  }
  return { picked: jobs.length, ok, failed };
}

/** Jobs left RUNNING by a crashed worker are re-queued after 15 minutes. */
export async function recoverStuck() {
  await prisma.syncJob.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: "QUEUED" },
  });
}

let lastReminder = 0;
export async function tick() {
  await recoverStuck();
  const r = await processDueJobs();
  if (Date.now() - lastReminder > 60 * 60_000) {
    lastReminder = Date.now();
    await runReminders().catch((e) => console.error("[reminders]", e));
    await runDailyBackup().catch((e) => console.error("[backup]", e));
  }
  return r;
}
