/**
 * STORAGE_BACKEND=drive (the Google Cloud Run set-up): files live only in Google Drive.
 * Runs the full lifecycle against the MOCK Drive adapter and checks that:
 *  - uploads go to the Drive FILE STORE, nothing is written to the server disk
 *  - archiving MOVES files into the claim folder (no duplicates), and stays idempotent
 *  - files remain readable after the move
 *  - production refuses to store files when Google is not connected
 */
import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const MOCK = ".test-mock-drive-ds";
const DISK = ".test-storage-ds";
process.env.STORAGE_BACKEND = "drive";
process.env.ALLOW_MOCK_DRIVE_STORAGE = "1";
process.env.MOCK_DRIVE_DIR = MOCK;
process.env.STORAGE_DIR = DISK;

const fixture = (n: string) => fs.readFile(path.join("tests/fixtures", n));
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (!e.name.startsWith(".")) out.push(p);
  }
  return out;
}

let m: {
  prisma: typeof import("@/lib/db").prisma;
  claims: typeof import("@/lib/claims");
  docs: typeof import("@/lib/documents");
  review: typeof import("@/lib/review");
  storage: typeof import("@/lib/storage");
  worker: typeof import("@/lib/worker");
  archive: typeof import("@/lib/archive");
};
const user = (email: string) => m.prisma.user.findUniqueOrThrow({ where: { email }, include: { branch: true } });

beforeAll(async () => {
  m = {
    prisma: (await import("@/lib/db")).prisma,
    claims: await import("@/lib/claims"),
    docs: await import("@/lib/documents"),
    review: await import("@/lib/review"),
    storage: await import("@/lib/storage"),
    worker: await import("@/lib/worker"),
    archive: await import("@/lib/archive"),
  };
  await m.prisma.$executeRawUnsafe(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' LOOP
      EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE'; END LOOP; END $$;`);
  execSync("npx tsx prisma/seed.ts && npx tsx prisma/seed-demo.ts", { env: process.env, stdio: "ignore" });
  await fs.rm(MOCK, { recursive: true, force: true });
  await fs.rm(DISK, { recursive: true, force: true });
});

describe("Google Drive as primary file storage", () => {
  let claimId = "";
  let docId = "";

  it("uploads go to the Drive file store, not the server disk", async () => {
    const alice = await user("alice@example.test");
    const cat = await m.prisma.expenseCategory.findFirstOrThrow({ where: { name: "STATIONERY" } });
    const c = await m.claims.createDraft(alice, { year: 2026, month: 11 });
    claimId = c.id;
    const line = await m.claims.saveLine(alice, claimId, {
      expenseDate: "2026-11-03", categoryId: cat.id, branchId: alice.branchId!, supplier: "Demo Stationery Enterprise",
      description: "Files", businessPurpose: "Office supplies", receiptNo: "INV-5521", amount: "42.50",
    });
    const original = await fixture("receipt-b.jpg");
    [docId] = await m.docs.addLineDocuments(alice, claimId, line.id, [{ name: "stationery.jpg", data: original }]);
    const doc = await m.prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.storageKey).toMatch(/^drive:mock:/);
    expect((await walk(MOCK)).some((f) => f.includes("FILE STORE"))).toBe(true);
    expect(await walk(DISK)).toEqual([]); // nothing on the server disk
    // read back byte-for-byte (cache cleared to force a Drive read)
    m.storage.forget(doc.storageKey);
    expect((await m.storage.getFile(doc.storageKey)).equals(original)).toBe(true);
  });

  it("full lifecycle archives by MOVING files into the claim folder", async () => {
    const alice = await user("alice@example.test");
    const fin = await user("finance@example.test");
    const dir = await user("director@example.test");
    await m.claims.submitClaim(alice, claimId, "ds-submit-1");
    const line = await m.prisma.claimLine.findFirstOrThrow({ where: { claimId } });
    await m.review.setLineVerification(fin, line.id, { status: "VERIFIED" });
    await m.review.financeVerify(fin, claimId, null, { splitQueried: true });
    await m.review.directorApprove(dir, claimId, null);
    const b = await m.review.createBatch(fin, [claimId]);
    await m.review.updateBatchDetails(fin, b.id, { paymentDate: "2026-11-16", method: "INSTANT TRANSFER (OCBC)", bankRef: "TEST-1" });
    await m.review.postBatch(fin, b.id);

    await m.prisma.syncJob.updateMany({ data: { runAfter: new Date(0) } });
    for (let i = 0; i < 10; i++) {
      if (!(await m.worker.processDueJobs(50)).picked) break;
      await m.prisma.syncJob.updateMany({ where: { status: "QUEUED" }, data: { runAfter: new Date(0) } });
    }
    const c = await m.prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(c.archiveStatus).toBe("ARCHIVED");
    const files = await walk(MOCK);
    const originals = files.filter((f) => f.includes("02_Original_Receipts"));
    expect(originals).toHaveLength(1);
    // moved, not copied: the receipt is no longer in the FILE STORE staging folder
    expect(files.filter((f) => f.includes("FILE STORE") && f.endsWith("stationery.jpg"))).toHaveLength(0);
    const doc = await m.prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.driveFileId).toContain("02_Original_Receipts");
    expect(doc.storageKey).toBe(`drive:${doc.driveFileId}`);
    m.storage.forget(doc.storageKey);
    expect((await m.storage.getFile(doc.storageKey)).equals(await fixture("receipt-b.jpg"))).toBe(true);
    expect(files.some((f) => f.includes("05_Approval_Records") && f.includes("Audit Trail"))).toBe(true);
    expect(files.some((f) => f.includes("01_Claim_Summary") && f.includes("Paid"))).toBe(true);
    expect(await walk(DISK)).toEqual([]);

    // idempotent: archiving again creates no extra files
    const before = (await walk(MOCK)).length;
    await m.archive.archiveClaim(claimId);
    expect((await walk(MOCK)).length).toBe(before);
  });

  it("refuses to store files on a production server when Google is not connected", async () => {
    const prev = { env: process.env.NODE_ENV, allow: process.env.ALLOW_MOCK_DRIVE_STORAGE };
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.ALLOW_MOCK_DRIVE_STORAGE;
    try {
      await expect(m.storage.putFile("2026-11/x/y.jpg", Buffer.from("x"))).rejects.toThrow(/Google is not connected/);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev.env!;
      process.env.ALLOW_MOCK_DRIVE_STORAGE = prev.allow;
    }
  });
});
