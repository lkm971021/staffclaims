/**
 * Daily database backup to Google Drive, and restore.
 *
 * Free database tiers (e.g. Neon / Supabase free) have little or no backup history, so the app
 * writes its own: a gzipped JSON export of every table into a private Drive folder
 * "STAFF CLAIMS APP - DATABASE BACKUPS", keeping the most recent `KEEP` files.
 * Restore with:  npx tsx scripts/restore-backup.ts <backup-file.json.gz>
 * (into a freshly migrated, EMPTY database).
 */
import { gzipSync, gunzipSync } from "zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { todayMY } from "./time";

export const KEEP = Number(process.env.BACKUP_KEEP || 35);
const FORMAT = 1;

/** Restore order respects foreign keys. Names are Prisma model delegates. */
export const TABLES = [
  "company", "branch", "user", "teamDelegation", "expenseCategory", "setting", "refCounter", "googleCredential",
  "claim", "claimLine", "document", "ocrResult", "duplicateFlag", "claimVersion", "adjustment", "workflowEvent",
  "paymentBatch", "paymentItem", "notification", "auditLog", "syncJob", "driveFolder", "idempotencyKey",
] as const;
type Table = (typeof TABLES)[number];
type Delegate = { findMany: (a?: unknown) => Promise<Record<string, unknown>[]>; createMany: (a: { data: unknown[] }) => Promise<unknown>; count: () => Promise<number> };
const del = (t: Table) => (prisma as unknown as Record<Table, Delegate>)[t];

export async function exportDatabase() {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await del(t).findMany();
  const migrations = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`;
  const payload = { format: FORMAT, exportedAt: new Date().toISOString(), lastMigration: migrations[0]?.migration_name ?? null, tables };
  const json = Buffer.from(JSON.stringify(payload));
  return { gz: gzipSync(json), counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) };
}

/** Insert a backup into an EMPTY database (after `prisma migrate deploy`). Never deletes anything. */
export async function restoreDatabase(gz: Buffer) {
  const payload = JSON.parse(gunzipSync(gz).toString("utf8")) as { format: number; tables: Record<string, Record<string, unknown>[]> };
  if (payload.format !== FORMAT) throw new Error(`Unsupported backup format ${payload.format}`);
  const existing = await prisma.claim.count() + (await prisma.user.count());
  if (existing > 0) throw new Error("Target database is not empty. Restore only into a freshly migrated, empty database.");
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    let rows = payload.tables[t] ?? [];
    if (t === "claim") rows = [...rows].sort((a, b) => Number(Boolean(a.parentClaimId)) - Number(Boolean(b.parentClaimId))); // parents first
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) o[k] = v === null && isJsonColumn(t, k) ? Prisma.DbNull : v;
        return o;
      });
      await del(t).createMany({ data: chunk });
    }
    counts[t] = rows.length;
  }
  return counts;
}

/** Nullable JSON columns need Prisma.DbNull instead of null on insert. */
function isJsonColumn(t: Table, k: string) {
  return (t === "auditLog" && (k === "before" || k === "after")) || (t === "idempotencyKey" && k === "result");
}

/** Run once per Malaysian calendar day (called from the worker / cron tick). */
export async function runDailyBackup(force = false) {
  const today = todayMY();
  const last = (await prisma.setting.findUnique({ where: { key: "lastBackup" } }))?.value as { date?: string } | null;
  if (!force && last?.date === today) return { skipped: "already backed up today" };
  const { getDrive } = await import("./google/drive");
  const drive = await getDrive();
  if (drive.mode === "mock" && process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_DRIVE_STORAGE !== "1")
    return { skipped: "Google not connected" };
  const key = `backupRoot:${drive.mode}`;
  let root = (await prisma.setting.findUnique({ where: { key } }))?.value as string | undefined;
  if (!root) {
    root = await drive.createRoot("STAFF CLAIMS APP - DATABASE BACKUPS");
    await prisma.setting.upsert({ where: { key }, update: { value: root }, create: { key, value: root } });
  }
  const { gz, counts } = await exportDatabase();
  const stamp = new Date().toISOString().replace(/[:]/g, "").slice(0, 15);
  const name = `staff-claims-db-${today}-${stamp}.json.gz`;
  const id = await drive.upload(root, name, "application/gzip", gz, name);
  // retention: keep the newest KEEP backups
  const files = (await drive.list(root)).filter((f) => f.name.startsWith("staff-claims-db-")).sort((a, b) => b.name.localeCompare(a.name));
  for (const old of files.slice(KEEP)) await drive.trash(old.id);
  const info = { date: today, at: new Date().toISOString(), file: name, fileId: id, sizeBytes: gz.length, mode: drive.mode, claims: counts.claim, kept: Math.min(files.length, KEEP) };
  await prisma.setting.upsert({ where: { key: "lastBackup" }, update: { value: info }, create: { key: "lastBackup", value: info } });
  return info;
}
