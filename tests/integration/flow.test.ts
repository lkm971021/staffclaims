/**
 * End-to-end backend flow against a real PostgreSQL test database (claims_test) using DEMO users,
 * dummy receipts and the MOCK Google Drive/Sheets adapters (no live Google access in tests).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { createDraft, saveLine, submitClaim, UserError } from "@/lib/claims";
import { addLineDocuments } from "@/lib/documents";
import { canViewClaim } from "@/lib/rbac";
import {
  setLineVerification, financeVerify, financeReturn, directorApprove, createBatch, updateBatchDetails, postBatch, resolveDuplicate,
} from "@/lib/review";
import { processDueJobs } from "@/lib/worker";

const env = { ...process.env };
const userBy = (email: string) => prisma.user.findUniqueOrThrow({ where: { email }, include: { branch: true } });
const fixture = (n: string) => fs.readFile(path.join("tests/fixtures", n));

async function drainJobs() {
  await prisma.syncJob.updateMany({ data: { runAfter: new Date(0) }, where: { status: "QUEUED" } });
  for (let i = 0; i < 20; i++) {
    const r = await processDueJobs(50);
    if (!r.picked) break;
    await prisma.syncJob.updateMany({ data: { runAfter: new Date(0) }, where: { status: "QUEUED" } });
  }
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' LOOP
      EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE'; END LOOP; END $$;`);
  execSync("npx tsx prisma/seed.ts && npx tsx prisma/seed-demo.ts", { env: { ...env, DATABASE_URL: process.env.DATABASE_URL }, stdio: "ignore" });
  await fs.rm(".test-storage", { recursive: true, force: true });
  await fs.rm(".test-mock-drive", { recursive: true, force: true });
});

describe("full claim lifecycle", () => {
  let claimId = "";
  let lineIds: string[] = [];

  it("staff creates a draft with two expenses and receipts", async () => {
    const alice = await userBy("alice@example.test");
    const cats = await prisma.expenseCategory.findMany();
    const parking = cats.find((c) => c.name === "PARKING")!;
    const stationery = cats.find((c) => c.name === "STATIONERY")!;
    const claim = await createDraft(alice, { year: 2026, month: 10 });
    expect(claim.ref).toBe("CLM-2026-10-0001");
    claimId = claim.id;
    const l1 = await saveLine(alice, claimId, {
      expenseDate: "2026-10-12", categoryId: parking.id, branchId: alice.branchId!, supplier: "Demo Parking Sdn Bhd",
      description: "Parking at supplier visit", businessPurpose: "Visit equipment supplier", location: "Jalan Test, PJ",
      receiptNo: "P-10293", amount: "85.00",
    });
    const l2 = await saveLine(alice, claimId, {
      expenseDate: "2026-10-14", categoryId: stationery.id, branchId: alice.branchId!, supplier: "Demo Stationery Enterprise",
      description: "Files and pens", businessPurpose: "Branch office supplies", receiptNo: "INV-5521", amount: "42.50",
    });
    lineIds = [l1.id, l2.id];
    await addLineDocuments(alice, claimId, l1.id, [{ name: "parking.jpg", data: await fixture("receipt-a.jpg") }]);
    await addLineDocuments(alice, claimId, l2.id, [{ name: "stationery.jpg", data: await fixture("receipt-b.jpg") }]);
    // re-upload of the identical file is ignored
    await addLineDocuments(alice, claimId, l2.id, [{ name: "stationery-again.jpg", data: await fixture("receipt-b.jpg") }]);
    expect(await prisma.document.count({ where: { claimId, kind: "ORIGINAL" } })).toBe(2);
  });

  it("rejects non-image/PDF uploads", async () => {
    const alice = await userBy("alice@example.test");
    await expect(addLineDocuments(alice, claimId, lineIds[0], [{ name: "x.exe", data: Buffer.from("MZ not a receipt") }])).rejects.toThrow(UserError);
  });

  it("blocks submission when a required receipt is missing", async () => {
    const alice = await userBy("alice@example.test");
    const tmp = await createDraft(alice, { year: 2026, month: 10 });
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: "TOLL" } });
    await saveLine(alice, tmp.id, {
      expenseDate: "2026-10-03", categoryId: cat.id, branchId: alice.branchId!, supplier: "PLUS", description: "Toll", businessPurpose: "Branch visit", location: "PJ-KL", amount: "5.20",
    });
    await expect(submitClaim(alice, tmp.id, "key-missing-receipt-1")).rejects.toThrow(/attach the receipt/);
  });

  it("other staff cannot view the claim; Finance can; Director only after verification", async () => {
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(await canViewClaim(await userBy("ben@example.test"), claim)).toBe(false);
    expect(await canViewClaim(await userBy("chloe@example.test"), claim)).toBe(false);
    expect(await canViewClaim(await userBy("finance@example.test"), claim)).toBe(true);
    expect(await canViewClaim(await userBy("director@example.test"), claim)).toBe(false);
  });

  it("submit is idempotent (double tap / retry does not double submit)", async () => {
    const alice = await userBy("alice@example.test");
    const r1 = await submitClaim(alice, claimId, "submit-key-abc123");
    const r2 = await submitClaim(alice, claimId, "submit-key-abc123");
    expect(r1).toEqual(r2);
    const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(c.status).toBe("PENDING_FINANCE");
    expect(await prisma.claimVersion.count({ where: { claimId } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "CLAIM_SUBMITTED" } })).toBeGreaterThan(0);
  });

  it("staff cannot edit after submission", async () => {
    const alice = await userBy("alice@example.test");
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: "PARKING" } });
    await expect(
      saveLine(alice, claimId, { id: lineIds[0], expenseDate: "2026-10-12", categoryId: cat.id, branchId: alice.branchId!, supplier: "X", description: "Y", amount: "999" }),
    ).rejects.toThrow(/no longer be edited/);
  });

  it("Finance returns the claim; staff corrects and resubmits as version 2", async () => {
    const fin = await userBy("finance@example.test");
    const alice = await userBy("alice@example.test");
    await expect(financeReturn(fin, claimId, "")).rejects.toThrow(/reason/);
    await financeReturn(fin, claimId, "Please add the location for the parking expense in more detail.");
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: "PARKING" } });
    await saveLine(alice, claimId, {
      id: lineIds[0], expenseDate: "2026-10-12", categoryId: cat.id, branchId: alice.branchId!, supplier: "Demo Parking Sdn Bhd",
      description: "Parking at supplier visit", businessPurpose: "Visit equipment supplier", location: "Menara Test car park, Jalan Test, PJ",
      receiptNo: "P-10293", amount: "85.00",
    });
    await submitClaim(alice, claimId, "submit-key-resubmit-2");
    const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(c.version).toBe(2);
    expect(await prisma.claimVersion.count({ where: { claimId } })).toBe(2);
  });

  it("duplicate receipt by another staff member is flagged (not rejected)", async () => {
    const ben = await userBy("ben@example.test");
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { name: "PARKING" } });
    const dup = await createDraft(ben, { year: 2026, month: 11 });
    const l = await saveLine(ben, dup.id, {
      expenseDate: "2026-10-12", categoryId: cat.id, branchId: ben.branchId!, supplier: "Demo Parking Sdn. Bhd.", description: "Parking",
      businessPurpose: "Visit", location: "PJ", receiptNo: "P10293", amount: "85",
    });
    await addLineDocuments(ben, dup.id, l.id, [{ name: "same.jpg", data: await fixture("receipt-a.jpg") }]);
    const r = await submitClaim(ben, dup.id, "submit-key-ben-dup");
    expect(r.refs[0]).toMatch(/^CLM-2026-11-/);
    const flags = await prisma.duplicateFlag.findMany({ where: { lineId: l.id } });
    const rules = flags.map((f) => f.rule).sort();
    expect(rules).toContain("FILE_HASH");
    expect(rules).toContain("SUPPLIER_INVOICE_NO");
    expect(rules).toContain("SUPPLIER_DATE_AMOUNT");
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: dup.id } })).status).toBe("PENDING_FINANCE");
    // Finance cannot verify that line until the flags are decided
    const fin = await userBy("finance@example.test");
    await expect(setLineVerification(fin, l.id, { status: "VERIFIED" })).rejects.toThrow(/duplicate/);
    for (const f of flags) await resolveDuplicate(fin, f.id, "DUPLICATE", "Same receipt already claimed by another staff member.");
    await setLineVerification(fin, l.id, { status: "REJECTED", comment: "Duplicate of an earlier claim" });
  });

  it("partial verification with an adjustment requires a reason and is recorded", async () => {
    const fin = await userBy("finance@example.test");
    // the original claim's lines are also flagged as matching Ben's later duplicate? Only Ben's line matched earlier claims.
    await expect(setLineVerification(fin, lineIds[1], { status: "VERIFIED", verifiedAmount: "40.00" })).rejects.toThrow(/reason/);
    await setLineVerification(fin, lineIds[1], { status: "VERIFIED", verifiedAmount: "40.00", adjustmentReason: "Personal item RM2.50 excluded" });
    const openFlags = await prisma.duplicateFlag.findMany({ where: { lineId: lineIds[0], decision: "OPEN" } });
    for (const f of openFlags) await resolveDuplicate(fin, f.id, "NOT_DUPLICATE", "Original claim - the later one is the duplicate.");
    await setLineVerification(fin, lineIds[0], { status: "VERIFIED" });
    expect(await prisma.adjustment.count({ where: { lineId: lineIds[1] } })).toBe(1);
    const line = await prisma.claimLine.findUniqueOrThrow({ where: { id: lineIds[1] } });
    expect(line.amountSen).toBe(4250); // original submitted amount never changed
    expect(line.verifiedAmountSen).toBe(4000);
  });

  it("Finance cannot verify own claim; Director sees claim only after verification and approves", async () => {
    const fin = await userBy("finance@example.test");
    const dir = await userBy("director@example.test");
    await expect(directorApprove(dir, claimId, null)).rejects.toThrow(/not awaiting Director/);
    const r = await financeVerify(fin, claimId, "All receipts valid", { splitQueried: true });
    expect(r.status).toBe("PENDING_DIRECTOR");
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(await canViewClaim(dir, claim)).toBe(true);
    await directorApprove(dir, claimId, "OK");
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: claimId } })).status).toBe("APPROVED_FOR_PAYMENT");
  });

  it("payment batch: required details, paid once only", async () => {
    const fin = await userBy("finance@example.test");
    const batch = await createBatch(fin, [claimId]);
    expect(batch.ref).toMatch(/^PAY-\d{4}-\d{2}-001$/);
    await expect(createBatch(fin, [claimId])).rejects.toThrow(/already in a payment batch/);
    await expect(postBatch(fin, batch.id)).rejects.toThrow(/payment date/);
    await updateBatchDetails(fin, batch.id, { paymentDate: "2026-11-16", method: "INSTANT TRANSFER (OCBC)", bankRef: "OCBC-TEST-0001" });
    await postBatch(fin, batch.id);
    const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId }, include: { paymentItem: true } });
    expect(c.status).toBe("PAID");
    expect(c.paymentItem?.amountSen).toBe(12500); // 85.00 + 40.00
    await expect(postBatch(fin, batch.id)).rejects.toThrow(/already been posted/);
    // database refuses to alter a posted batch
    await expect(prisma.paymentBatch.update({ where: { id: batch.id }, data: { bankRef: "CHANGED" } })).rejects.toThrow();
  });

  it("audit records cannot be deleted; submitted claims cannot be deleted", async () => {
    await expect(prisma.workflowEvent.deleteMany({ where: { claimId } })).rejects.toThrow(/append-only/);
    await expect(prisma.claim.delete({ where: { id: claimId } })).rejects.toThrow();
  });

  it("worker archives to (mock) Drive and syncs the (mock) Master Listing", async () => {
    await drainJobs();
    const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId }, include: { claimant: true } });
    expect(c.archiveStatus).toBe("ARCHIVED");
    expect(c.driveFolderUrl).toMatch(/^mock:\/\//);
    const folder = path.join(".test-mock-drive", c.driveFolderId!.replace(/^mock:/, ""));
    expect(folder).toContain(path.join("2026", "10. OCT", "PJ MIDTOWN", "D0001. DEMO STAFF ALICE", "CLM-2026-10-0001"));
    const originals = await fs.readdir(path.join(folder, "02_Original_Receipts"));
    expect(originals.filter((f) => !f.startsWith(".")).length).toBe(2);
    const summaries = (await fs.readdir(path.join(folder, "01_Claim_Summary"))).filter((f) => f.endsWith(".pdf"));
    expect(summaries.some((f) => f.includes("Paid"))).toBe(true);
    const combined = (await fs.readdir(path.join(folder, "03_Combined_PDF"))).filter((f) => f.endsWith(".pdf"));
    expect(combined.length).toBeGreaterThanOrEqual(2); // v1 and v2
    expect((await fs.readdir(path.join(folder, "05_Approval_Records"))).some((f) => f.includes("Audit Trail"))).toBe(true);

    // demo claims go to the DEMO master listing, never the real one
    const wbFile = (await fs.readdir(".test-mock-drive")).find((f) => f.startsWith("DEMO TEST") && f.endsWith(".xlsx"))!;
    expect(wbFile).toBeTruthy();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(".test-mock-drive", wbFile));
    const reg = wb.getWorksheet("Master Register")!;
    const keys: string[] = [];
    reg.eachRow((r, i) => i > 1 && keys.push(String(r.getCell(1).value)));
    expect(keys.filter((k) => k.startsWith("CLM-2026-10-0001#")).sort()).toEqual(["CLM-2026-10-0001#1", "CLM-2026-10-0001#2"]);
    expect(wb.getWorksheet("Payments")!.rowCount).toBe(2);

    // re-running the sync does not duplicate rows
    const { syncClaimToSheet } = await import("@/lib/archive");
    await syncClaimToSheet(claimId);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(path.join(".test-mock-drive", wbFile));
    let n = 0;
    wb2.getWorksheet("Master Register")!.eachRow((r, i) => i > 1 && String(r.getCell(1).value).startsWith("CLM-2026-10-0001#") && n++);
    expect(n).toBe(2);
  });
});
