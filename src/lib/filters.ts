import type { ClaimStatus, Prisma } from "@prisma/client";
import type { SessionUser } from "./rbac";

export interface ClaimFilters {
  year?: number;
  month?: number;
  claimantId?: string;
  branchId?: string;
  categoryId?: string;
  companyId?: string;
  status?: string; // a ClaimStatus or a group key
  payment?: "PAID" | "UNPAID" | "";
  q?: string;
  queue?: string;
}

export const STATUS_GROUPS: Record<string, { label: string; statuses: ClaimStatus[] }> = {
  finance: { label: "Pending Finance verification", statuses: ["PENDING_FINANCE", "CLARIFICATION"] },
  director: { label: "Pending Director approval", statuses: ["PENDING_DIRECTOR"] },
  payment: { label: "Approved but unpaid", statuses: ["APPROVED_FOR_PAYMENT"] },
  paid: { label: "Paid", statuses: ["PAID"] },
  returned: { label: "Returned / rejected", statuses: ["RETURNED", "REJECTED"] },
  open: { label: "All open (not paid / rejected)", statuses: ["PENDING_FINANCE", "CLARIFICATION", "RETURNED", "PENDING_DIRECTOR", "APPROVED_FOR_PAYMENT"] },
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function parseFilters(sp: SP): ClaimFilters {
  const y = Number(one(sp.year));
  const m = Number(one(sp.month));
  return {
    year: y || undefined,
    month: m >= 1 && m <= 12 ? m : undefined,
    claimantId: one(sp.employee),
    branchId: one(sp.branch),
    categoryId: one(sp.category),
    companyId: one(sp.company),
    status: one(sp.status) ?? one(sp.queue),
    payment: (one(sp.payment) as ClaimFilters["payment"]) ?? "",
    q: one(sp.q)?.trim(),
    queue: one(sp.queue),
  };
}

export function toQuery(f: ClaimFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (f.year) p.set("year", String(f.year));
  if (f.month) p.set("month", String(f.month));
  if (f.claimantId) p.set("employee", f.claimantId);
  if (f.branchId) p.set("branch", f.branchId);
  if (f.categoryId) p.set("category", f.categoryId);
  if (f.companyId) p.set("company", f.companyId);
  if (f.status) p.set("status", f.status);
  if (f.payment) p.set("payment", f.payment);
  if (f.q) p.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** Claim-level where clause. Drafts are never shown to Finance. Demo and real data never mix. */
export function claimWhere(f: ClaimFilters, viewer: SessionUser): Prisma.ClaimWhereInput {
  const and: Prisma.ClaimWhereInput[] = [{ status: { not: "DRAFT" } }, { claimant: { isDemo: viewer.isDemo } }];
  if (f.year) and.push({ claimYear: f.year });
  if (f.month) and.push({ claimMonth: f.month });
  if (f.claimantId) and.push({ claimantId: f.claimantId });
  if (f.branchId) and.push({ OR: [{ claimant: { branchId: f.branchId } }, { lines: { some: { branchId: f.branchId } } }] });
  if (f.categoryId) and.push({ lines: { some: { categoryId: f.categoryId } } });
  if (f.companyId) and.push({ companyId: f.companyId });
  if (f.status) {
    if (f.status === "duplicates") and.push({ lines: { some: { duplicateFlags: { some: { decision: "OPEN" } } } } });
    else if (f.status === "archive") and.push({ archiveStatus: { in: ["PENDING", "FAILED"] } });
    else if (f.status === "hardcopy") and.push({ status: { in: ["PENDING_DIRECTOR", "APPROVED_FOR_PAYMENT", "PAID"] }, lines: { some: { hardcopyReceivedAt: null, finStatus: "VERIFIED" } } });
    else if (STATUS_GROUPS[f.status]) and.push({ status: { in: STATUS_GROUPS[f.status].statuses } });
    else and.push({ status: f.status as ClaimStatus });
  }
  if (f.payment === "PAID") and.push({ status: "PAID" });
  if (f.payment === "UNPAID") and.push({ status: "APPROVED_FOR_PAYMENT" });
  if (f.q) {
    and.push({
      OR: [
        { ref: { contains: f.q, mode: "insensitive" } },
        { claimant: { name: { contains: f.q, mode: "insensitive" } } },
        { claimant: { employeeNo: { contains: f.q } } },
        { lines: { some: { supplier: { contains: f.q, mode: "insensitive" } } } },
        { lines: { some: { receiptNo: { contains: f.q, mode: "insensitive" } } } },
      ],
    });
  }
  return { AND: and };
}

/** Line-level where clause (for line-based reports / accounting export). */
export function lineWhere(f: ClaimFilters, viewer: SessionUser): Prisma.ClaimLineWhereInput {
  const and: Prisma.ClaimLineWhereInput[] = [{ claim: claimWhere({ ...f, branchId: undefined, categoryId: undefined }, viewer) }];
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  return { AND: and };
}
