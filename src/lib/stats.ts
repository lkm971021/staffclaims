import "server-only";
import { prisma } from "./db";
import { claimWhere, type ClaimFilters } from "./filters";
import type { SessionUser } from "./rbac";

export interface Buckets {
  submitted: { n: number; sen: number };
  pendingFinance: { n: number; sen: number };
  pendingDirector: { n: number; sen: number };
  financeVerified: { n: number; sen: number };
  directorApproved: { n: number; sen: number };
  approvedUnpaid: { n: number; sen: number };
  paid: { n: number; sen: number };
  returnedRejected: { n: number; sen: number };
  adjustments: { n: number; sen: number }; // claimed minus verified on verified lines
  advances: { n: number; sen: number };
}

const z = () => ({ n: 0, sen: 0 });

/** Monthly payment-control figures. Amounts: submitted figures until Finance verifies; verified figures after. */
export async function buckets(f: ClaimFilters, viewer: SessionUser): Promise<Buckets> {
  const claims = await prisma.claim.findMany({
    where: claimWhere(f, viewer),
    select: { id: true, status: true, advanceSen: true, isDirectorOwnClaim: true, lines: { select: { amountSen: true, finStatus: true, verifiedAmountSen: true } }, paymentItem: { select: { amountSen: true, batch: { select: { status: true } } } } },
  });
  const b: Buckets = {
    submitted: z(), pendingFinance: z(), pendingDirector: z(), financeVerified: z(), directorApproved: z(), approvedUnpaid: z(), paid: z(),
    returnedRejected: z(), adjustments: z(), advances: z(),
  };
  const add = (k: keyof Buckets, sen: number) => {
    b[k].n++;
    b[k].sen += sen;
  };
  for (const c of claims) {
    const sub = c.lines.reduce((a, l) => a + l.amountSen, 0);
    const ver = c.lines.filter((l) => l.finStatus === "VERIFIED").reduce((a, l) => a + (l.verifiedAmountSen ?? l.amountSen), 0) - c.advanceSen;
    add("submitted", sub);
    if (c.advanceSen) add("advances", c.advanceSen);
    const adj = c.lines.filter((l) => l.finStatus === "VERIFIED" && l.verifiedAmountSen !== null && l.verifiedAmountSen !== l.amountSen);
    if (adj.length) add("adjustments", adj.reduce((a, l) => a + l.amountSen - (l.verifiedAmountSen ?? l.amountSen), 0));
    switch (c.status) {
      case "PENDING_FINANCE":
      case "CLARIFICATION":
        add("pendingFinance", sub);
        break;
      case "PENDING_DIRECTOR":
        add("pendingDirector", ver);
        add("financeVerified", ver);
        break;
      case "APPROVED_FOR_PAYMENT":
        add("financeVerified", ver);
        add("directorApproved", ver);
        add("approvedUnpaid", ver);
        break;
      case "PAID":
        add("financeVerified", ver);
        add("directorApproved", ver);
        add("paid", c.paymentItem?.amountSen ?? ver);
        break;
      case "RETURNED":
      case "REJECTED":
        add("returnedRejected", sub);
        break;
    }
    // rejected lines inside otherwise-verified claims
    const rejLines = c.lines.filter((l) => l.finStatus === "REJECTED");
    if (rejLines.length && !["RETURNED", "REJECTED"].includes(c.status)) {
      b.returnedRejected.sen += rejLines.reduce((a, l) => a + l.amountSen, 0);
    }
  }
  return b;
}

export interface ReconWarning {
  level: "error" | "warning";
  message: string;
  href?: string;
}

/** Reconciliation checks between claims, approvals and payments. */
export async function reconciliation(f: ClaimFilters, viewer: SessionUser): Promise<ReconWarning[]> {
  const out: ReconWarning[] = [];
  const where = claimWhere(f, viewer);
  const claims = await prisma.claim.findMany({
    where,
    select: {
      id: true, ref: true, status: true, advanceSen: true, archiveStatus: true,
      lines: { select: { amountSen: true, finStatus: true, verifiedAmountSen: true } },
      paymentItem: { select: { amountSen: true, batch: { select: { status: true, ref: true } } } },
    },
  });
  for (const c of claims) {
    const ver = c.lines.filter((l) => l.finStatus === "VERIFIED").reduce((a, l) => a + (l.verifiedAmountSen ?? l.amountSen), 0) - c.advanceSen;
    if (c.status === "PAID" && c.paymentItem?.batch.status !== "POSTED")
      out.push({ level: "error", message: `${c.ref} is marked Paid but has no posted payment batch.`, href: `/finance/claims/${c.id}` });
    if (c.status === "PAID" && c.paymentItem && c.paymentItem.amountSen !== ver)
      out.push({ level: "error", message: `${c.ref}: paid amount differs from the verified amount.`, href: `/finance/claims/${c.id}` });
    if (c.paymentItem?.batch.status === "POSTED" && c.status !== "PAID")
      out.push({ level: "error", message: `${c.ref} is in posted batch ${c.paymentItem.batch.ref} but its status is not Paid.`, href: `/finance/claims/${c.id}` });
    if (["PENDING_DIRECTOR", "APPROVED_FOR_PAYMENT", "PAID"].includes(c.status) && c.lines.some((l) => l.finStatus === "PENDING" || l.finStatus === "QUERIED"))
      out.push({ level: "error", message: `${c.ref} passed Finance with unverified lines.`, href: `/finance/claims/${c.id}` });
    if (ver < 0) out.push({ level: "warning", message: `${c.ref}: advance exceeds the verified amount.`, href: `/finance/claims/${c.id}` });
    if (c.archiveStatus === "FAILED" || (c.archiveStatus === "PENDING" && c.status === "PAID"))
      out.push({ level: "warning", message: `${c.ref}: documents not yet fully archived to Google Drive.`, href: `/finance/claims/${c.id}` });
  }
  const failedJobs = await prisma.syncJob.count({ where: { status: "FAILED" } });
  if (failedJobs) out.push({ level: "warning", message: `${failedJobs} Google Drive / Sheets job(s) failed after all retries. See Admin › System jobs.`, href: "/admin/jobs" });
  const staleBatches = await prisma.paymentBatch.findMany({
    where: { status: "DRAFT", createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    select: { id: true, ref: true },
  });
  for (const b of staleBatches)
    out.push({ level: "warning", message: `Payment batch ${b.ref} has been in draft for over 7 days.`, href: `/finance/payments/${b.id}` });
  return out;
}
