/**
 * Database backup -> Drive (mock) -> restore into a NEW empty database, then compare every table.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const MOCK = ".test-mock-drive-bk";
process.env.MOCK_DRIVE_DIR = MOCK;
process.env.STORAGE_DIR = ".test-storage-bk";
const RESTORE_DB = "claims_restore_test";
const restoreUrl = (process.env.DATABASE_URL as string).replace(/\/claims_test\?/, `/${RESTORE_DB}?`);

let m: { prisma: typeof import("@/lib/db").prisma; backup: typeof import("@/lib/backup"); claims: typeof import("@/lib/claims"); docs: typeof import("@/lib/documents") };

beforeAll(async () => {
  m = { prisma: (await import("@/lib/db")).prisma, backup: await import("@/lib/backup"), claims: await import("@/lib/claims"), docs: await import("@/lib/documents") };
  await m.prisma.$executeRawUnsafe(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' LOOP
      EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE'; END LOOP; END $$;`);
  execSync("npx tsx prisma/seed.ts && npx tsx prisma/seed-demo.ts", { env: process.env, stdio: "ignore" });
  await fs.rm(MOCK, { recursive: true, force: true });
  // some realistic data incl. a submitted claim, audit rows and JSON columns
  const alice = await m.prisma.user.findUniqueOrThrow({ where: { email: "alice@example.test" }, include: { branch: true } });
  const cat = await m.prisma.expenseCategory.findFirstOrThrow({ where: { name: "PARKING" } });
  const c = await m.claims.createDraft(alice, { year: 2026, month: 11 });
  const l = await m.claims.saveLine(alice, c.id, {
    expenseDate: "2026-11-02", categoryId: cat.id, branchId: alice.branchId!, supplier: "Demo Parking", description: "Parking",
    businessPurpose: "Supplier visit", location: "PJ", receiptNo: "P-1", amount: "12.30",
  });
  await m.docs.addLineDocuments(alice, c.id, l.id, [{ name: "p.jpg", data: await fs.readFile("tests/fixtures/receipt-a.jpg") }]);
  await m.claims.submitClaim(alice, c.id, "bk-submit-1");
  execSync(`psql -h /tmp -U postgres -qc "DROP DATABASE IF EXISTS ${RESTORE_DB}" -c "CREATE DATABASE ${RESTORE_DB} OWNER claims"`, { stdio: "ignore" });
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: restoreUrl }, stdio: "ignore" });
});

describe("daily database backup", () => {
  it("writes a backup to the Drive backups folder once per day", async () => {
    const r = await m.backup.runDailyBackup();
    expect("file" in r && r.file).toMatch(/^staff-claims-db-\d{4}-\d{2}-\d{2}-.*\.json\.gz$/);
    expect((await m.backup.runDailyBackup()) as { skipped?: string }).toEqual({ skipped: "already backed up today" });
    const dir = path.join(MOCK, "STAFF CLAIMS APP - DATABASE BACKUPS");
    expect((await fs.readdir(dir)).filter((f) => f.endsWith(".json.gz"))).toHaveLength(1);
  });

  it("restores into a new empty database with identical data, and refuses a non-empty one", async () => {
    const dir = path.join(MOCK, "STAFF CLAIMS APP - DATABASE BACKUPS");
    const file = path.join(dir, (await fs.readdir(dir)).find((f) => f.endsWith(".json.gz"))!);
    execSync(`npx tsx scripts/restore-backup.ts "${file}"`, { env: { ...process.env, DATABASE_URL: restoreUrl }, stdio: "pipe" });
    const target = new PrismaClient({ datasources: { db: { url: restoreUrl } } });
    try {
      for (const t of ["user", "claim", "claimLine", "document", "workflowEvent", "auditLog", "claimVersion", "expenseCategory", "setting"] as const) {
        const a = await (m.prisma as unknown as Record<string, { count: () => Promise<number> }>)[t].count();
        const b = await (target as unknown as Record<string, { count: () => Promise<number> }>)[t].count();
        // the "lastBackup" setting is written after the export, so the backup cannot contain it
        expect({ t, b }).toEqual({ t, b: a - (t === "setting" ? 1 : 0) });
      }
      const src = await m.prisma.claim.findFirstOrThrow({ include: { lines: true, versions: true } });
      const dst = await target.claim.findUniqueOrThrow({ where: { id: src.id }, include: { lines: true, versions: true } });
      expect(JSON.parse(JSON.stringify(dst))).toEqual(JSON.parse(JSON.stringify(src)));
      // audit triggers still enforced after restore
      await expect(target.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    } finally {
      await target.$disconnect();
    }
    expect(() => execSync(`npx tsx scripts/restore-backup.ts "${file}"`, { env: { ...process.env, DATABASE_URL: restoreUrl }, stdio: "pipe" })).toThrow();
  });
});
