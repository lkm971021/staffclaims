import "server-only";
import type { Company, Document } from "@prisma/client";
import { prisma } from "./db";
import { getDrive, type DriveAdapter } from "./google/drive";
import { getSheets, type SheetsAdapter } from "./google/sheets";
import { claimInclude, claimRow, registerRows, REGISTER_COLUMNS, CLAIM_COLUMNS } from "./listing";
import { claimSummaryPdf, auditTrailPdf } from "./pdf/summary";
import { combineToPdf, type CombineItem } from "./pdf/combine";
import { getFile, newKey, putFile } from "./storage";
import { toJpeg } from "./files";
import { sha256 } from "./crypto";
import { getSettings, setSetting } from "./settings";
import { driveMonthFolder, ymdOf, MONTHS_LONG } from "./time";
import { STATUS_SHORT } from "./workflow";
import { toDecimal } from "./money";

export const SUBFOLDERS = {
  summary: "01_Claim_Summary",
  originals: "02_Original_Receipts",
  combined: "03_Combined_PDF",
  enhanced: "03_Combined_PDF/Enhanced_Images",
  additional: "04_Additional_Supporting_Documents",
  approval: "05_Approval_Records",
} as const;

const SYSTEM_USER = "system";

async function companyRoot(drive: DriveAdapter, company: Company, demo: boolean): Promise<string> {
  const s = await getSettings();
  const isMock = (id: string | null | undefined) => !id || id.startsWith("mock:");
  const wantMock = drive.mode === "mock";
  if (demo) {
    const key = `demoDriveRoot:${company.code}:${drive.mode}`;
    const row = await prisma.setting.findUnique({ where: { key } });
    if (row) return row.value as string;
    const id = await drive.createRoot(`DEMO TEST - ${company.name} - ${s.driveRootFolderName}`);
    await prisma.setting.create({ data: { key, value: id } });
    return id;
  }
  if (company.driveRootId && isMock(company.driveRootId) === wantMock) return company.driveRootId;
  const id = await drive.createRoot(`${company.name} - ${s.driveRootFolderName}`);
  await prisma.company.update({ where: { id: company.id }, data: { driveRootId: id } });
  return id;
}

function docFolder(d: Document): string {
  switch (d.kind) {
    case "ORIGINAL":
      return SUBFOLDERS.originals;
    case "ENHANCED":
      return SUBFOLDERS.enhanced;
    case "COMBINED_PDF":
    case "CLAIM_SUPPORTING_PDF":
      return SUBFOLDERS.combined;
    case "CLAIM_SUMMARY":
      return SUBFOLDERS.summary;
    case "APPROVAL_RECORD":
      return SUBFOLDERS.approval;
    default:
      return SUBFOLDERS.additional;
  }
}

async function storeGenerated(claimId: string, kind: Document["kind"], version: number, filename: string, data: Buffer) {
  const key = newKey(claimId, ".pdf");
  await putFile(key, data);
  return prisma.document.create({
    data: { claimId, kind, version, filename, mime: "application/pdf", sizeBytes: data.length, sha256: sha256(data), storageKey: key, uploadedById: SYSTEM_USER },
  });
}

/** Build the combined "Supporting Documents" PDF for a claim (all active documents, in line order). */
export async function buildSupportingPdf(claimId: string): Promise<Buffer> {
  const c = await prisma.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { documents: { where: { kind: { in: ["ORIGINAL", "ADDITIONAL"] }, removedAt: null, supersededAt: null }, orderBy: { pageOrder: "asc" } } },
      },
    },
  });
  const items: CombineItem[] = [];
  for (const l of c.lines) {
    for (const d of l.documents) {
      const label = `Expense ${l.lineNo}: ${l.supplier}`;
      if (d.mime === "application/pdf") items.push({ type: "pdf", bytes: await getFile(d.storageKey), label });
      else {
        const enh = await prisma.document.findFirst({ where: { derivedFromId: d.id, kind: "ENHANCED" }, orderBy: { uploadedAt: "desc" } });
        items.push({ type: "image", jpeg: await toJpeg(await getFile((enh ?? d).storageKey)), label });
      }
    }
  }
  return combineToPdf(items, c.ref);
}

/** Generate the combined supporting PDF for the claim's current version (once per version). */
export async function ensureSupportingPdf(claimId: string) {
  const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  const exists = await prisma.document.findFirst({ where: { claimId, kind: "CLAIM_SUPPORTING_PDF", version: c.version } });
  if (exists) return exists;
  return storeGenerated(claimId, "CLAIM_SUPPORTING_PDF", c.version, `${c.ref} - Supporting Documents v${c.version}.pdf`, await buildSupportingPdf(claimId));
}

/**
 * Archive a claim to Google Drive (or the local mock). Idempotent: safe to run any number of times.
 * The claim is only marked ARCHIVED once every required document has a confirmed Drive file id.
 */
export async function archiveClaim(claimId: string) {
  const s = await getSettings();
  const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId }, include: claimInclude });
  if (c.status === "DRAFT") return { skipped: "draft" };
  const drive = await getDrive();
  const demo = c.claimant.isDemo;

  // 1. Generated documents for the current state
  await ensureSupportingPdf(claimId);
  const docs = await prisma.document.findMany({ where: { claimId } });
  const stage = STATUS_SHORT[c.status];
  const summaryName = `${c.ref} - Claim Summary v${c.version} - ${stage}.pdf`;
  if (!docs.some((d) => d.kind === "CLAIM_SUMMARY" && d.filename === summaryName)) {
    await storeGenerated(claimId, "CLAIM_SUMMARY", c.version, summaryName, await claimSummaryPdf(c, s.formNotes));
  }
  const trail = await auditTrailPdf(c);

  // 2. Folder tree: <Company root>/<YYYY>/<M. MON>/<Branch>/<EmpNo. NAME>/<Claim ref>/
  const root = await companyRoot(drive, c.company, demo);
  const parts = [
    String(c.claimYear),
    driveMonthFolder(c.claimMonth),
    c.claimant.branch?.name ?? "NO BRANCH",
    `${c.claimant.employeeNo}. ${c.claimant.name}`,
    c.ref,
  ];
  const claimFolder = await drive.ensurePath(root, parts);
  const folderIds: Record<string, string> = {};
  for (const sub of Object.values(SUBFOLDERS)) folderIds[sub] = await drive.ensurePath(claimFolder, sub.split("/"));
  await prisma.claim.update({ where: { id: claimId }, data: { driveFolderId: claimFolder, driveFolderUrl: drive.folderUrl(claimFolder) } });

  // 3. Upload every document not yet uploaded (originals are never altered; superseded ones are kept)
  const lineNo = new Map(c.lines.map((l) => [l.id, l.lineNo]));
  const all = await prisma.document.findMany({ where: { claimId, removedAt: null }, orderBy: { uploadedAt: "asc" } });
  let failures = 0;
  for (const d of all) {
    if (d.driveStatus === "UPLOADED" && d.driveFileId && d.driveFileId.startsWith("mock:") === (drive.mode === "mock")) continue;
    if (d.kind === "APPROVAL_RECORD") continue;
    const prefix = d.lineId ? `L${String(lineNo.get(d.lineId) ?? 0).padStart(2, "0")}-` : "";
    const name = `${d.supersededAt ? "SUPERSEDED-" : ""}${prefix}${d.filename}`;
    try {
      const id = await drive.upload(folderIds[docFolder(d)], name, d.mime, await getFile(d.storageKey), d.id);
      await prisma.document.update({ where: { id: d.id }, data: { driveFileId: id, driveStatus: "UPLOADED", driveError: null } });
    } catch (e) {
      failures++;
      await prisma.document.update({ where: { id: d.id }, data: { driveStatus: "FAILED", driveError: String((e as Error).message).slice(0, 500) } });
    }
  }

  // 4. Audit trail: one file, content refreshed each time (Drive keeps the revision history)
  try {
    let rec = await prisma.document.findFirst({ where: { claimId, kind: "APPROVAL_RECORD" } });
    if (!rec) rec = await storeGenerated(claimId, "APPROVAL_RECORD", c.version, `${c.ref} - Audit Trail.pdf`, trail);
    else {
      // keep the local copy current too (used by downloads / ZIP); earlier copies stay on disk
      const key = newKey(claimId, ".pdf");
      await putFile(key, trail);
      rec = await prisma.document.update({ where: { id: rec.id }, data: { storageKey: key, sizeBytes: trail.length, sha256: sha256(trail) } });
    }
    if (rec.driveFileId && rec.driveFileId.startsWith("mock:") === (drive.mode === "mock")) await drive.updateContent(rec.driveFileId, "application/pdf", trail);
    else {
      const id = await drive.upload(folderIds[SUBFOLDERS.approval], rec.filename, "application/pdf", trail, rec.id);
      await drive.updateContent(id, "application/pdf", trail);
      await prisma.document.update({ where: { id: rec.id }, data: { driveFileId: id, driveStatus: "UPLOADED" } });
    }
  } catch (e) {
    failures++;
    console.error("[archive] audit trail", e);
  }

  // 5. Archive status
  const required = await prisma.document.findMany({
    where: {
      claimId, removedAt: null,
      OR: [
        { kind: "ORIGINAL", supersededAt: null },
        { kind: "CLAIM_SUPPORTING_PDF", version: c.version },
        { kind: "CLAIM_SUMMARY", filename: summaryName },
      ],
    },
  });
  const done = failures === 0 && required.every((d) => d.driveStatus === "UPLOADED" && d.driveFileId);
  await prisma.claim.update({ where: { id: claimId }, data: { archiveStatus: done ? "ARCHIVED" : "PENDING" } });
  if (!done) throw new Error(`Archive incomplete for ${c.ref}: ${failures} upload(s) failed; will retry.`);
  return { mode: drive.mode, folder: drive.folderUrl(claimFolder) };
}

// ---------------------------------------------------------------- Google Sheets master listing

const TABS = {
  register: { name: "Master Register", headers: REGISTER_COLUMNS },
  claims: { name: "Claims", headers: CLAIM_COLUMNS },
  payments: {
    name: "Payments",
    headers: ["Key", "Payment Batch", "Company", "Payment Date", "Method", "Batch Reference", "Claim Reference", "Employee ID", "Employee Name", "Amount Paid (RM)", "Payment Reference", "Posted By", "Posted At"],
  },
  summary: {
    name: "Monthly Summary",
    headers: ["Claim Month", "Branch", "Claims", "Submitted (RM)", "Pending Finance (RM)", "Pending Director (RM)", "Approved Unpaid (RM)", "Paid (RM)", "Rejected (RM)"],
  },
} as const;

async function masterSheet(sheets: SheetsAdapter, demo: boolean): Promise<string> {
  const key = demo ? `demoMasterSheetId:${sheets.mode}` : `masterSheetId:${sheets.mode}`;
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row?.value) {
    await sheets.ensureTabs(row.value as string, Object.values(TABS));
    return row.value as string;
  }
  const holding = await prisma.company.findFirstOrThrow({ where: { isHolding: true } });
  const drive = await getDrive();
  const parent = await companyRoot(drive, holding, demo);
  const title = demo ? "DEMO TEST - Staff Claims - Master Claim Listing" : "Staff Claims - Master Claim Listing";
  const id = await sheets.createSpreadsheet(title, Object.values(TABS), parent.startsWith("mock:") ? undefined : parent);
  await prisma.setting.upsert({ where: { key }, update: { value: id }, create: { key, value: id } });
  if (!demo && sheets.mode === "live") await setSetting("masterSheetId", id, "system");
  return id;
}

async function monthlySummaryRows(demo: boolean) {
  const lines = await prisma.claimLine.findMany({
    where: { claim: { status: { not: "DRAFT" }, claimant: { isDemo: demo } } },
    include: { claim: { select: { claimYear: true, claimMonth: true, status: true, id: true } }, branch: true },
  });
  const map = new Map<string, { claims: Set<string>; sub: number; pf: number; pd: number; au: number; paid: number; rej: number }>();
  for (const l of lines) {
    const k = `${l.claim.claimYear}-${String(l.claim.claimMonth).padStart(2, "0")}|${l.branch.name}`;
    const m = map.get(k) ?? { claims: new Set(), sub: 0, pf: 0, pd: 0, au: 0, paid: 0, rej: 0 };
    m.claims.add(l.claim.id);
    m.sub += l.amountSen;
    const v = l.finStatus === "VERIFIED" ? l.verifiedAmountSen ?? l.amountSen : 0;
    const st = l.claim.status;
    if (st === "PENDING_FINANCE" || st === "CLARIFICATION" || st === "RETURNED") m.pf += l.amountSen;
    else if (st === "PENDING_DIRECTOR") m.pd += v;
    else if (st === "APPROVED_FOR_PAYMENT") m.au += v;
    else if (st === "PAID") m.paid += v;
    else if (st === "REJECTED") m.rej += l.amountSen;
    if (l.finStatus === "REJECTED" && st !== "REJECTED") m.rej += l.amountSen;
    map.set(k, m);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, m]) => {
      const [month, branch] = k.split("|");
      return [month, branch, m.claims.size, toDecimal(m.sub), toDecimal(m.pf), toDecimal(m.pd), toDecimal(m.au), toDecimal(m.paid), toDecimal(m.rej)];
    });
}

export async function syncClaimToSheet(claimId: string) {
  const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId }, include: claimInclude });
  if (c.status === "DRAFT") return { skipped: "draft" };
  const sheets = await getSheets();
  const demo = c.claimant.isDemo;
  const id = await masterSheet(sheets, demo);
  await sheets.replaceGroup(id, TABS.register.name, c.ref, registerRows(c));
  await sheets.replaceGroup(id, TABS.claims.name, c.ref, [claimRow(c)]);
  await sheets.replaceAll(id, TABS.summary, await monthlySummaryRows(demo));
  await prisma.claim.update({ where: { id: claimId }, data: { sheetSyncedAt: new Date() } });
  return { mode: sheets.mode, url: sheets.url(id) };
}

export async function syncBatch(batchId: string) {
  const b = await prisma.paymentBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { company: true, items: { include: { claim: { include: { claimant: true } } } } },
  });
  if (b.status !== "POSTED") return { skipped: "not posted" };
  const postedBy = b.postedById ? await prisma.user.findUnique({ where: { id: b.postedById } }) : null;
  for (const demo of [false, true]) {
    const items = b.items.filter((i) => i.claim.claimant.isDemo === demo);
    if (!items.length) continue;
    const sheets = await getSheets();
    const id = await masterSheet(sheets, demo);
    await sheets.replaceGroup(
      id,
      TABS.payments.name,
      b.ref,
      items.map((i) => [
        `${b.ref}#${i.claim.ref}`, b.ref, b.company.name, b.paymentDate ? ymdOf(b.paymentDate) : "", b.method ?? "", b.bankRef ?? "",
        i.claim.ref, i.claim.claimant.employeeNo, i.claim.claimant.name, toDecimal(i.amountSen), i.paymentRef ?? b.bankRef ?? "",
        postedBy?.name ?? "", b.postedAt?.toISOString() ?? "",
      ]),
    );
    // payment proof -> <company root>/PAYMENTS/<YYYY>/<PAY ref>/
    if (b.proofDocKey && !b.proofDriveFileId && !demo) {
      const drive = await getDrive();
      const root = await companyRoot(drive, b.company, false);
      const folder = await drive.ensurePath(root, ["PAYMENTS", b.ref.slice(4, 8), b.ref]);
      const fid = await drive.upload(folder, b.proofDocName ?? `${b.ref} - payment proof`, "application/octet-stream", await getFile(b.proofDocKey), `proof-${b.id}`);
      await prisma.paymentBatch.update({ where: { id: b.id }, data: { proofDriveFileId: fid } });
    }
  }
  return { ok: true };
}

export const monthName = (m: number) => MONTHS_LONG[m - 1];
