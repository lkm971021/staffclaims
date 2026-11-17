import "server-only";
import { z } from "zod";
import type { Claim, ClaimLine, Document, ExpenseCategory, OcrResult, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit, type Actor } from "./audit";
import { nextClaimRef } from "./refs";
import { canSubmitFor, type SessionUser } from "./rbac";
import { getSettings, einvoiceApplies, type AppSettings } from "./settings";
import { dateOnly, ymdOf, monthLabel, todayMY } from "./time";
import { parseToSen, rm } from "./money";
import { transition, submittedTotal } from "./workflow";
import { detectDuplicatesForClaim } from "./duplicates";
import { notify, notifyRole } from "./notify";
import { enqueue } from "./jobs";
import { ensureSupportingPdf } from "./archive";

export class UserError extends Error {}

const actorOf = (u: SessionUser): Actor => ({ id: u.id, name: u.name });

// ---------------------------------------------------------------- drafts

export async function createDraft(u: SessionUser, input: { claimantId?: string; year: number; month: number }) {
  const claimantId = input.claimantId || u.id;
  if (!(await canSubmitFor(u.id, claimantId))) throw new UserError("You cannot create claims for this staff member.");
  if (input.month < 1 || input.month > 12 || input.year < 2020 || input.year > 2100) throw new UserError("Invalid claim month.");
  const claimant = await prisma.user.findUniqueOrThrow({ where: { id: claimantId }, include: { branch: true } });
  const companyId =
    claimant.branch?.companyId ?? (await prisma.company.findFirstOrThrow({ where: { isHolding: true } })).id;
  return prisma.$transaction(async (tx) => {
    const ref = await nextClaimRef(tx, input.year, input.month);
    const claim = await tx.claim.create({
      data: {
        ref,
        companyId,
        claimantId,
        submittedById: u.id,
        claimYear: input.year,
        claimMonth: input.month,
        isDirectorOwnClaim: claimant.roles.includes("DIRECTOR"),
      },
    });
    await audit(tx, actorOf(u), "Claim", claim.id, "CREATE_DRAFT", undefined, { ref, claimantId });
    return claim;
  });
}

/** Staff may discard a never-submitted draft. Submitted claims can never be deleted (DB-enforced). */
export async function discardDraft(u: SessionUser, claimId: string) {
  const c = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  if (c.status !== "DRAFT" || c.firstSubmittedAt) throw new UserError("Only never-submitted drafts can be discarded.");
  if (!(await canSubmitFor(u.id, c.claimantId))) throw new UserError("Not allowed.");
  await prisma.$transaction(async (tx) => {
    await audit(tx, actorOf(u), "Claim", c.id, "DISCARD_DRAFT", { ref: c.ref });
    await tx.claim.delete({ where: { id: c.id } });
  });
}

async function loadEditable(u: SessionUser, claimId: string) {
  const c = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!c) throw new UserError("Claim not found.");
  if (!(await canSubmitFor(u.id, c.claimantId))) throw new UserError("Not allowed.");
  if (c.status !== "DRAFT" && c.status !== "RETURNED")
    throw new UserError("This claim has been submitted and can no longer be edited.");
  return c;
}

// ---------------------------------------------------------------- lines

const optStr = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const LineInput = z.object({
  id: z.string().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expense date is required"),
  categoryId: z.string().min(1, "Expense category is required"),
  branchId: z.string().min(1, "Branch is required"),
  supplier: z.string().trim().min(1, "Merchant / supplier is required").max(200),
  description: z.string().trim().min(1, "Description is required").max(500),
  businessPurpose: optStr,
  location: optStr,
  receiptNo: optStr,
  amount: z.string().min(1, "Amount is required"),
  staffPaymentMethod: z.string().default("CASH"),
  docIsReceipt: z.boolean().default(true),
  docIsEinvoice: z.boolean().default(false),
  supplierTin: optStr,
  supplierBrn: optStr,
  supplierSst: optStr,
  invoiceNo: optStr,
  invoiceDate: optStr,
  einvoiceUuid: optStr,
  einvoiceStatus: optStr,
  remarks: optStr,
  /** documents uploaded before the line existed (unattached) to attach to this line */
  attachDocIds: z.array(z.string()).max(30).default([]),
});
export type LineInputT = z.input<typeof LineInput>;

export async function saveLine(u: SessionUser, claimId: string, raw: LineInputT) {
  const claim = await loadEditable(u, claimId);
  const parsed = LineInput.safeParse(raw);
  if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => i.message).join("; "));
  const v = parsed.data;
  const amountSen = parseToSen(v.amount);
  if (amountSen === null || amountSen <= 0) throw new UserError("Enter a valid amount greater than zero (e.g. 85.00).");
  if (amountSen > 10_000_000) throw new UserError("Amount looks too large. Please check.");
  if (v.expenseDate > todayMY()) throw new UserError("Expense date cannot be in the future.");
  if (v.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.invoiceDate)) throw new UserError("Invalid invoice date.");
  const [category, branch] = await Promise.all([
    prisma.expenseCategory.findFirst({ where: { id: v.categoryId, active: true } }),
    prisma.branch.findFirst({ where: { id: v.branchId, active: true } }),
  ]);
  if (!category) throw new UserError("Please choose a valid expense category.");
  if (!branch) throw new UserError("Please choose a valid branch.");

  const data = {
    expenseDate: dateOnly(v.expenseDate),
    categoryId: v.categoryId,
    branchId: v.branchId,
    supplier: v.supplier,
    description: v.description,
    businessPurpose: v.businessPurpose,
    location: v.location,
    receiptNo: v.receiptNo,
    amountSen,
    staffPaymentMethod: v.staffPaymentMethod,
    docIsReceipt: v.docIsReceipt,
    docIsEinvoice: v.docIsEinvoice,
    supplierTin: v.supplierTin,
    supplierBrn: v.supplierBrn,
    supplierSst: v.supplierSst,
    invoiceNo: v.invoiceNo,
    invoiceDate: v.invoiceDate ? dateOnly(v.invoiceDate) : null,
    einvoiceUuid: v.einvoiceUuid,
    einvoiceStatus: v.einvoiceStatus,
    remarks: v.remarks,
  };

  return prisma.$transaction(async (tx) => {
    if (v.id) {
      const before = await tx.claimLine.findFirst({ where: { id: v.id, claimId } });
      if (!before) throw new UserError("Line not found.");
      // A corrected line goes back to Finance as pending
      const line = await tx.claimLine.update({
        where: { id: v.id },
        data: { ...data, finStatus: before.finStatus === "VERIFIED" && claim.status === "RETURNED" && sameMoney(before, data) ? before.finStatus : "PENDING" },
      });
      if (claim.status === "RETURNED") await audit(tx, actorOf(u), "ClaimLine", line.id, "AMEND_RETURNED_LINE", before, line);
      await attach(tx, claimId, line.id, v.attachDocIds);
      return line;
    }
    const max = await tx.claimLine.aggregate({ where: { claimId }, _max: { lineNo: true } });
    const line = await tx.claimLine.create({ data: { ...data, claimId, lineNo: (max._max.lineNo ?? 0) + 1 } });
    if (claim.status === "RETURNED") await audit(tx, actorOf(u), "ClaimLine", line.id, "ADD_LINE_TO_RETURNED", undefined, line);
    await attach(tx, claimId, line.id, v.attachDocIds);
    return line;
  });
}

async function attach(tx: Prisma.TransactionClient, claimId: string, lineId: string, ids: string[]) {
  if (!ids.length) return;
  // only unattached documents of this claim; enhanced derivatives follow their original
  const docs = await tx.document.findMany({ where: { id: { in: ids }, claimId, lineId: null, removedAt: null } });
  const ok = docs.map((d) => d.id);
  await tx.document.updateMany({ where: { OR: [{ id: { in: ok } }, { derivedFromId: { in: ok } }], claimId }, data: { lineId } });
}

function sameMoney(a: { amountSen: number; expenseDate: Date; supplier: string }, b: { amountSen: number; expenseDate: Date; supplier: string }) {
  return a.amountSen === b.amountSen && ymdOf(a.expenseDate) === ymdOf(b.expenseDate) && a.supplier === b.supplier;
}

export async function deleteLine(u: SessionUser, claimId: string, lineId: string) {
  const claim = await loadEditable(u, claimId);
  await prisma.$transaction(async (tx) => {
    const line = await tx.claimLine.findFirst({ where: { id: lineId, claimId } });
    if (!line) throw new UserError("Line not found.");
    if (claim.firstSubmittedAt) {
      // keep documents for history: detach from line but keep on the claim
      await tx.document.updateMany({ where: { lineId }, data: { supersededAt: new Date(), lineId: null } });
    }
    await audit(tx, actorOf(u), "ClaimLine", lineId, "DELETE_LINE", line);
    await tx.claimLine.delete({ where: { id: lineId } });
    // renumber
    const rest = await tx.claimLine.findMany({ where: { claimId }, orderBy: { lineNo: "asc" } });
    for (let i = 0; i < rest.length; i++) await tx.claimLine.update({ where: { id: rest[i].id }, data: { lineNo: -(i + 1) } });
    for (let i = 0; i < rest.length; i++) await tx.claimLine.update({ where: { id: rest[i].id }, data: { lineNo: i + 1 } });
  });
}

export async function updateClaimMeta(u: SessionUser, claimId: string, data: { staffRemarks?: string | null; year?: number; month?: number }) {
  const c = await loadEditable(u, claimId);
  const upd: Prisma.ClaimUpdateInput = {};
  if (data.staffRemarks !== undefined) upd.staffRemarks = data.staffRemarks?.slice(0, 1000) || null;
  if (data.year && data.month && !c.firstSubmittedAt) {
    upd.claimYear = data.year;
    upd.claimMonth = data.month;
  }
  return prisma.claim.update({ where: { id: c.id }, data: upd });
}

// ---------------------------------------------------------------- validation

export type LineWithDocs = ClaimLine & {
  category: ExpenseCategory;
  documents: (Document & { ocr: OcrResult[] })[];
};

export interface Check {
  level: "error" | "warning";
  code: string;
  message: string;
  lineNo?: number;
}

/** Errors block submission; warnings are shown to staff and recorded for Finance. */
export function checkClaim(claim: Pick<Claim, "claimYear" | "claimMonth">, lines: LineWithDocs[], s: AppSettings): Check[] {
  const out: Check[] = [];
  if (lines.length === 0) out.push({ level: "error", code: "NO_LINES", message: "Add at least one expense." });
  const mm = `${claim.claimYear}-${String(claim.claimMonth).padStart(2, "0")}`;
  for (const l of lines) {
    const n = l.lineNo;
    const add = (level: Check["level"], code: string, message: string) => out.push({ level, code, message, lineNo: n });
    const docs = l.documents.filter((d) => d.kind === "ORIGINAL" && !d.removedAt && !d.supersededAt);
    if (l.category.requiresReceipt && docs.length === 0)
      add("error", "NO_DOC", `Expense ${n}: attach the receipt / invoice (photo or PDF).`);
    if (l.category.requiresPurpose && !l.businessPurpose)
      add("error", "NO_PURPOSE", `Expense ${n}: state the business purpose.`);
    if (l.category.requiresLocation && !l.location)
      add("error", "NO_LOCATION", `Expense ${n}: state the location / route for ${l.category.name.toLowerCase()}.`);
    const ymd = ymdOf(l.expenseDate);
    if (!ymd.startsWith(mm))
      add("warning", "OUTSIDE_MONTH", `Expense ${n}: dated ${ymd}, which is outside the claim month ${monthLabel(claim.claimYear, claim.claimMonth)}.`);
    if (!l.receiptNo && !l.invoiceNo) add("warning", "NO_RECEIPT_NO", `Expense ${n}: no receipt / invoice number entered.`);
    if (l.category.warnAboveSen && l.amountSen > l.category.warnAboveSen)
      add("warning", "ABOVE_GUIDE", `Expense ${n}: ${rm(l.amountSen)} is above the ${l.category.name} guide amount of ${rm(l.category.warnAboveSen)} - Finance will review.`);
    if (l.category.specialApproval)
      add("warning", "SPECIAL", `Expense ${n}: ${l.category.name} needs special approval - include approval details in remarks if available.`);

    // e-Invoice (configurable; never classifies a document as invalid)
    if (einvoiceApplies(s, ymd, l.category.einvoiceApplicable)) {
      const labels: Record<string, string> = {
        supplierTin: "Supplier TIN", supplierBrn: "Supplier BRN", supplierSst: "Supplier SST No.", invoiceNo: "Invoice No.",
        invoiceDate: "Invoice Date", einvoiceUuid: "e-Invoice UUID", einvoiceStatus: "e-Invoice validation status",
      };
      for (const [field, mode] of Object.entries(s.einvoiceFields)) {
        const val = (l as unknown as Record<string, unknown>)[field];
        if (mode === "required" && !val) add("error", "EINV_REQUIRED", `Expense ${n}: ${labels[field]} is required from ${s.einvoiceEffectiveDate}.`);
      }
      if (!l.docIsEinvoice && !l.einvoiceUuid)
        add("warning", "EINV_MISSING", `Expense ${n}: no e-Invoice indicated. If the supplier issued one, please attach it.`);
    }

    // OCR comparisons (suggestions only)
    const ocr = docs.flatMap((d) => d.ocr).filter((o) => !o.error);
    const latest = ocr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (latest) {
      if (latest.totalSen !== null && Math.abs(latest.totalSen - l.amountSen) > 1)
        add("warning", "AMOUNT_MISMATCH", `Expense ${n}: amount mismatch detected. You entered ${rm(l.amountSen)} but the receipt appears to show ${rm(latest.totalSen)}. Please review the claim amount against the supporting document.`);
      if (latest.docDate && ymdOf(latest.docDate) !== ymd)
        add("warning", "DATE_MISMATCH", `Expense ${n}: receipt date appears to be ${ymdOf(latest.docDate)}, but the expense date entered is ${ymd}.`);
      if (latest.legible === false) add("warning", "ILLEGIBLE", `Expense ${n}: the receipt may be unclear. Consider retaking the photo.`);
      const raw = latest.raw as { appears_complete?: boolean; document_type?: string } | null;
      if (raw?.appears_complete === false) add("warning", "INCOMPLETE", `Expense ${n}: the document may be incomplete (part of it cut off).`);
      if (raw?.document_type === "payment_proof_only")
        add("warning", "PAYMENT_PROOF_ONLY", `Expense ${n}: this looks like a payment screenshot only. Payment proof is not expense proof - attach the receipt / invoice.`);
    }
  }
  return out;
}

export async function loadClaimForCheck(claimId: string) {
  return prisma.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { category: true, branch: true, documents: { include: { ocr: true } } },
      },
    },
  });
}

// ---------------------------------------------------------------- submission

export async function submitClaim(u: SessionUser, claimId: string, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length < 8) throw new UserError("Missing submission key.");
  const prior = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
  if (prior) return prior.result as { claimIds: string[]; refs: string[] }; // retry of a completed submission

  const s = await getSettings();
  const claim = await loadClaimForCheck(claimId);
  const action = claim.status === "RETURNED" ? "RESUBMIT" : "SUBMIT";
  const t = transition(action, {
    status: claim.status,
    actorRoles: u.roles,
    actorId: u.id,
    claimantId: claim.claimantId,
    isDirectorOwnClaim: claim.isDirectorOwnClaim,
    actorCanSubmitFor: await canSubmitFor(u.id, claim.claimantId),
  });
  if (!t.ok) throw new UserError(t.error);
  const checks = checkClaim(claim, claim.lines, s);
  const errors = checks.filter((c) => c.level === "error");
  if (errors.length) throw new UserError(errors.map((e) => e.message).join("\n"));

  // Split by company if lines are allocated to branches of more than one company.
  const byCompany = new Map<string, typeof claim.lines>();
  for (const l of claim.lines) byCompany.set(l.branch.companyId, [...(byCompany.get(l.branch.companyId) ?? []), l]);
  const primaryCompany = byCompany.has(claim.companyId) ? claim.companyId : claim.lines[0].branch.companyId;

  const result = await prisma.$transaction(
    async (tx) => {
      // optimistic lock: only one submit wins
      const locked = await tx.claim.updateMany({ where: { id: claim.id, status: claim.status, version: claim.version }, data: { updatedAt: new Date() } });
      if (locked.count !== 1) throw new UserError("This claim was changed by someone else. Please reload.");

      const claimIds = [claim.id];
      const refs = [claim.ref];
      if (claim.companyId !== primaryCompany) await tx.claim.update({ where: { id: claim.id }, data: { companyId: primaryCompany } });

      for (const [companyId, lines] of byCompany) {
        if (companyId === primaryCompany) continue;
        const ref = await nextClaimRef(tx, claim.claimYear, claim.claimMonth);
        const split = await tx.claim.create({
          data: {
            ref, companyId, claimantId: claim.claimantId, submittedById: u.id, claimYear: claim.claimYear,
            claimMonth: claim.claimMonth, isDirectorOwnClaim: claim.isDirectorOwnClaim, staffRemarks: claim.staffRemarks,
            parentClaimId: null,
          },
        });
        let n = 1;
        for (const l of lines) {
          await tx.claimLine.update({ where: { id: l.id }, data: { claimId: split.id, lineNo: 1000 + n } });
          await tx.document.updateMany({ where: { lineId: l.id }, data: { claimId: split.id } });
          await tx.claimLine.update({ where: { id: l.id }, data: { lineNo: n++ } });
        }
        await audit(tx, actorOf(u), "Claim", split.id, "SPLIT_BY_COMPANY", { from: claim.ref }, { ref });
        claimIds.push(split.id);
        refs.push(ref);
      }
      // renumber remaining lines of the original claim
      const remaining = await tx.claimLine.findMany({ where: { claimId: claim.id }, orderBy: { lineNo: "asc" } });
      for (let i = 0; i < remaining.length; i++) await tx.claimLine.update({ where: { id: remaining[i].id }, data: { lineNo: 1000 + i } });
      for (let i = 0; i < remaining.length; i++) await tx.claimLine.update({ where: { id: remaining[i].id }, data: { lineNo: i + 1 } });

      const now = new Date();
      for (const id of claimIds) {
        const c = await tx.claim.findUniqueOrThrow({
          where: { id },
          include: { lines: { orderBy: { lineNo: "asc" }, include: { category: true, branch: true, documents: { include: { ocr: true } } } } },
        });
        const newVersion = action === "RESUBMIT" ? c.version + 1 : c.version;
        // record warnings on each line for Finance
        const lineChecks = checkClaim(c, c.lines, s).filter((x) => x.level === "warning");
        for (const l of c.lines) {
          await tx.claimLine.update({
            where: { id: l.id },
            data: { warnings: lineChecks.filter((x) => x.lineNo === l.lineNo).map((x) => ({ code: x.code, message: x.message })) },
          });
        }
        // queried lines go back to Finance as pending after correction
        if (action === "RESUBMIT")
          await tx.claimLine.updateMany({ where: { claimId: id, finStatus: "QUERIED" }, data: { finStatus: "PENDING" } });
        // documents removed since the last version stay as history
        await tx.claim.update({
          where: { id },
          data: {
            status: "PENDING_FINANCE",
            version: newVersion,
            submittedAt: now,
            firstSubmittedAt: c.firstSubmittedAt ?? now,
            submittedById: u.id,
            archiveStatus: "PENDING",
          },
        });
        await tx.claimVersion.create({
          data: {
            claimId: id,
            version: newVersion,
            totalSen: submittedTotal(c.lines),
            createdById: u.id,
            reason: action === "RESUBMIT" ? "Resubmitted after correction" : "Initial submission",
            snapshot: JSON.parse(
              JSON.stringify({
                ref: c.ref, claimYear: c.claimYear, claimMonth: c.claimMonth, advanceSen: c.advanceSen, staffRemarks: c.staffRemarks,
                lines: c.lines.map((l) => ({
                  ...l, category: l.category.name, branch: l.branch.name,
                  documents: l.documents.filter((d) => !d.removedAt && !d.supersededAt).map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, sha256: d.sha256 })),
                })),
              }),
            ),
          },
        });
        await tx.workflowEvent.create({
          data: {
            claimId: id, fromStatus: c.status, toStatus: "PENDING_FINANCE", action, actorId: u.id, actorName: u.name,
            actorRole: u.id === c.claimantId ? "STAFF" : "TEAM_LEADER",
            remarks: u.id !== c.claimantId ? `Submitted on behalf of claimant` : undefined,
          },
        });
        await detectDuplicatesForClaim(id, tx);
        await notifyRole(tx, "FINANCE", {
          type: "CLAIM_SUBMITTED",
          title: `${action === "RESUBMIT" ? "Resubmitted" : "New"} claim ${c.ref}`,
          body: `${(await tx.user.findUniqueOrThrow({ where: { id: c.claimantId } })).name} - ${monthLabel(c.claimYear, c.claimMonth)} - ${rm(submittedTotal(c.lines))}`,
          claimId: id,
          link: `/finance/claims/${id}`,
        }, c.claimantId);
        if (u.id !== c.claimantId)
          await notify(tx, [c.claimantId], {
            type: "CLAIM_SUBMITTED_FOR_YOU", title: `Claim ${c.ref} submitted for you`, body: `Submitted by ${u.name}.`, claimId: id, link: `/staff/claims/${id}`,
          });
        await enqueue(tx, "ARCHIVE_CLAIM", { claimId: id }, `archive:${id}`);
        await enqueue(tx, "SHEETS_SYNC_CLAIM", { claimId: id }, `sheet:${id}`, 5_000);
      }
      const res = { claimIds, refs };
      await tx.idempotencyKey.create({ data: { key: idempotencyKey, userId: u.id, result: res } });
      await audit(tx, actorOf(u), "Claim", claim.id, action, undefined, res);
      return res;
    },
    { timeout: 60_000 },
  );
  // Freeze this version's combined supporting PDF locally right away (the worker retries if this fails).
  for (const id of result.claimIds) await ensureSupportingPdf(id).catch((e) => console.error("[submit] supporting pdf", e));
  return result;
}
