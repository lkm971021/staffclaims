import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { toDecimal } from "./money";
import { fmtDateTime, ymdOf } from "./time";
import { STATUS_LABEL } from "./workflow";

/** Master Register columns (one row per expense line). Shared by Google Sheets sync and exports. */
export const REGISTER_COLUMNS = [
  "Key", "Claim Reference", "Line No.", "Claim Month", "Submission Date", "Employee ID", "Employee Name", "Company",
  "Claimant Branch", "Expense Date", "Expense Category", "GL Account Code", "Expense Branch", "Supplier Name", "Description",
  "Business Purpose", "Receipt / Invoice No.", "Receipt", "E-Invoice", "Supplier TIN", "e-Invoice UUID", "Claim Amount (RM)",
  "Line Finance Status", "Verified Amount (RM)", "Claim Status", "Finance Verified By", "Finance Verification Date",
  "Director Approval Status", "Director Approved By", "Director Approval Date", "Approved Amount (RM)", "Payment Status",
  "Payment Batch", "Payment Date", "Payment Method", "Payment Reference", "Hard Copy Received", "Duplicate Flags",
  "Google Drive Folder", "Finance Remarks", "Last Updated",
] as const;

export const CLAIM_COLUMNS = [
  "Claim Reference", "Version", "Claim Month", "Employee ID", "Employee Name", "Company", "Claimant Branch", "Status",
  "Submitted By", "Submission Date", "Lines", "Submitted Total (RM)", "Verified Total (RM)", "Advance (RM)",
  "Reimbursable (RM)", "Finance Verified By", "Finance Verified Date", "Director Decision By", "Director Decision Date",
  "Payment Batch", "Payment Date", "Payment Method", "Payment Reference", "Archive Status", "Google Drive Folder", "Last Updated",
] as const;

export const claimInclude = {
  company: true,
  claimant: { include: { branch: true } },
  submittedBy: true,
  lines: { orderBy: { lineNo: "asc" }, include: { category: true, branch: true, duplicateFlags: true } },
  events: { orderBy: { at: "asc" } },
  paymentItem: { include: { batch: true } },
} satisfies Prisma.ClaimInclude;

export type ClaimFull = Prisma.ClaimGetPayload<{ include: typeof claimInclude }>;

const APPROVED = new Set(["APPROVED_FOR_PAYMENT", "PAID"]);

function lastEvent(c: ClaimFull, actions: string[]) {
  return [...c.events].reverse().find((e) => actions.includes(e.action));
}

export function directorStatus(c: ClaimFull) {
  if (c.isDirectorOwnClaim && c.financeVerifiedAt) return "N/A - Director's own claim (Finance final)";
  if (c.status === "PENDING_DIRECTOR") return "Pending";
  if (c.status === "CLARIFICATION") return "Clarification requested";
  const d = lastEvent(c, ["DIRECTOR_APPROVE", "DIRECTOR_REJECT"]);
  if (d?.action === "DIRECTOR_APPROVE") return "Approved";
  if (d?.action === "DIRECTOR_REJECT") return "Rejected";
  return "";
}

export function registerRows(c: ClaimFull) {
  const fv = lastEvent(c, ["FINANCE_VERIFY"]);
  const dd = lastEvent(c, ["DIRECTOR_APPROVE", "DIRECTOR_REJECT"]);
  const pb = c.paymentItem?.batch.status === "POSTED" ? c.paymentItem.batch : null;
  const submitted = c.submittedAt;
  return c.lines.map((l) => {
    const verified = l.finStatus === "VERIFIED" ? l.verifiedAmountSen ?? l.amountSen : null;
    const approved = APPROVED.has(c.status) && l.finStatus === "VERIFIED" ? verified : null;
    const dup = l.duplicateFlags.length
      ? l.duplicateFlags.map((f) => `${f.rule}:${f.decision}`).join(", ")
      : "";
    return [
      `${c.ref}#${l.lineNo}`,
      c.ref,
      l.lineNo,
      `${c.claimYear}-${String(c.claimMonth).padStart(2, "0")}`,
      submitted ? fmtDateTime(submitted) : "",
      c.claimant.employeeNo,
      c.claimant.name,
      c.company.name,
      c.claimant.branch?.name ?? "",
      ymdOf(l.expenseDate),
      l.category.name,
      l.category.glAccountCode ?? "",
      l.branch.name,
      l.supplier,
      l.description,
      l.businessPurpose ?? "",
      l.receiptNo ?? l.invoiceNo ?? "",
      l.docIsReceipt ? "Yes" : "No",
      l.docIsEinvoice ? "Yes" : "No",
      l.supplierTin ?? "",
      l.einvoiceUuid ?? "",
      toDecimal(l.amountSen),
      l.finStatus,
      toDecimal(verified),
      STATUS_LABEL[c.status],
      fv?.actorName ?? "",
      fv ? fmtDateTime(fv.at) : "",
      directorStatus(c),
      dd?.action === "DIRECTOR_APPROVE" ? dd.actorName : "",
      dd?.action === "DIRECTOR_APPROVE" ? fmtDateTime(dd.at) : "",
      toDecimal(approved),
      c.status === "PAID" ? "Paid" : APPROVED.has(c.status) ? "Unpaid" : "",
      pb?.ref ?? "",
      pb?.paymentDate ? ymdOf(pb.paymentDate) : "",
      pb?.method ?? "",
      pb ? c.paymentItem?.paymentRef ?? pb.bankRef ?? "" : "",
      l.hardcopyReceivedAt ? `Yes (${l.hardcopyReceivedBy})` : "No",
      dup,
      c.driveFolderUrl ?? "",
      [l.finComment, c.financeRemarks].filter(Boolean).join(" | "),
      fmtDateTime(new Date()),
    ];
  });
}

export function claimRow(c: ClaimFull) {
  const fv = lastEvent(c, ["FINANCE_VERIFY"]);
  const dd = lastEvent(c, ["DIRECTOR_APPROVE", "DIRECTOR_REJECT"]);
  const pb = c.paymentItem?.batch.status === "POSTED" ? c.paymentItem.batch : null;
  const sub = c.lines.reduce((a, l) => a + l.amountSen, 0);
  const ver = c.lines.filter((l) => l.finStatus === "VERIFIED").reduce((a, l) => a + (l.verifiedAmountSen ?? l.amountSen), 0);
  const anyVerified = c.lines.some((l) => l.finStatus !== "PENDING");
  return [
    c.ref, c.version, `${c.claimYear}-${String(c.claimMonth).padStart(2, "0")}`, c.claimant.employeeNo, c.claimant.name,
    c.company.name, c.claimant.branch?.name ?? "", STATUS_LABEL[c.status], c.submittedBy?.name ?? "",
    c.submittedAt ? fmtDateTime(c.submittedAt) : "", c.lines.length, toDecimal(sub), anyVerified ? toDecimal(ver) : "",
    toDecimal(c.advanceSen), anyVerified ? toDecimal(ver - c.advanceSen) : "", fv?.actorName ?? "", fv ? fmtDateTime(fv.at) : "",
    dd?.actorName ?? "", dd ? fmtDateTime(dd.at) : "", pb?.ref ?? "", pb?.paymentDate ? ymdOf(pb.paymentDate) : "",
    pb?.method ?? "", pb ? c.paymentItem?.paymentRef ?? pb.bankRef ?? "" : "", c.archiveStatus, c.driveFolderUrl ?? "",
    fmtDateTime(new Date()),
  ];
}

export async function loadClaimFull(id: string) {
  return prisma.claim.findUniqueOrThrow({ where: { id }, include: claimInclude });
}
