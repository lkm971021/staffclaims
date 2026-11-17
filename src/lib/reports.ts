import "server-only";
import { prisma } from "./db";
import { claimWhere, lineWhere, type ClaimFilters } from "./filters";
import type { SessionUser } from "./rbac";
import { claimInclude, claimRow, registerRows, REGISTER_COLUMNS, CLAIM_COLUMNS } from "./listing";
import { toDecimal } from "./money";
import { STATUS_LABEL, reimbursable, submittedTotal } from "./workflow";
import { fmtDate, monthLabel, ymdOf } from "./time";
import { getSettings } from "./settings";
import type { Table } from "./exports";

export const REPORTS = {
  register: "Master claim register (line level)",
  claims: "Claim listing (claim level)",
  "monthly-staff": "1. Monthly staff claim summary",
  employee: "2. Individual employee claim summary",
  branch: "3. Branch claim summary",
  "outstanding-finance": "4. Outstanding Finance verification",
  "pending-director": "5. Pending Director approval",
  "approved-unpaid": "6. Approved but unpaid claims",
  "monthly-paid": "7. Monthly paid claims",
  "rejected-returned": "8. Rejected and returned claims",
  accounting: "Accounting export (for SQL Accounting entry)",
  "by-category": "Summary by expense category / GL account",
  "by-payment-date": "Summary by payment date",
  "by-period": "Summary by accounting period",
} as const;
export type ReportKey = keyof typeof REPORTS;

function periodText(f: ClaimFilters) {
  if (f.year && f.month) return monthLabel(f.year, f.month);
  if (f.year) return `Year ${f.year}`;
  return "All periods";
}

async function loadClaims(f: ClaimFilters, u: SessionUser) {
  return prisma.claim.findMany({ where: claimWhere(f, u), include: claimInclude, orderBy: [{ claimYear: "asc" }, { claimMonth: "asc" }, { ref: "asc" }] });
}

const ver = (l: { finStatus: string; verifiedAmountSen: number | null; amountSen: number }) => (l.finStatus === "VERIFIED" ? l.verifiedAmountSen ?? l.amountSen : 0);
const APPROVED = new Set(["APPROVED_FOR_PAYMENT", "PAID"]);

function listing(title: string, claims: Awaited<ReturnType<typeof loadClaims>>, f: ClaimFilters): Table {
  return {
    title,
    subtitle: periodText(f),
    headers: ["Claim Ref", "Claim Month", "Employee ID", "Employee", "Branch", "Status", "Submitted", "Lines", "Claimed (RM)", "Verified (RM)", "Remarks"],
    rows: claims.map((c) => [
      c.ref, `${c.claimYear}-${String(c.claimMonth).padStart(2, "0")}`, c.claimant.employeeNo, c.claimant.name, c.claimant.branch?.name ?? "",
      STATUS_LABEL[c.status], fmtDate(c.submittedAt), c.lines.length, toDecimal(submittedTotal(c.lines)),
      c.lines.some((l) => l.finStatus !== "PENDING") ? toDecimal(reimbursable(c.lines, c.advanceSen)) : null,
      [c.financeRemarks, c.directorRemarks].filter(Boolean).join(" | "),
    ]),
    money: [8, 9],
    totals: true,
  };
}

function groupSum<T>(items: T[], key: (t: T) => string, vals: ((t: T) => number)[]) {
  const m = new Map<string, number[]>();
  for (const it of items) {
    const k = key(it);
    const cur = m.get(k) ?? vals.map(() => 0);
    vals.forEach((v, i) => (cur[i] += v(it)));
    m.set(k, cur);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export async function buildReport(key: ReportKey, f: ClaimFilters, u: SessionUser): Promise<Table> {
  const title = REPORTS[key];
  switch (key) {
    case "register": {
      const claims = await loadClaims(f, u);
      return { title, subtitle: periodText(f), headers: [...REGISTER_COLUMNS], rows: claims.flatMap((c) => registerRows(c)), money: [21, 23, 30], totals: true,
        pdfColumns: [1, 2, 3, 6, 9, 10, 13, 16, 21, 22, 23, 24, 33, 35] };
    }
    case "claims": {
      const claims = await loadClaims(f, u);
      return { title, subtitle: periodText(f), headers: [...CLAIM_COLUMNS], rows: claims.map(claimRow), money: [11, 12, 13, 14], totals: true,
        pdfColumns: [0, 2, 4, 6, 7, 9, 11, 12, 13, 14, 19, 20, 22] };
    }
    case "outstanding-finance":
      return listing(title, await loadClaims({ ...f, status: "finance" }, u), f);
    case "pending-director":
      return listing(title, await loadClaims({ ...f, status: "director" }, u), f);
    case "approved-unpaid":
      return listing(title, await loadClaims({ ...f, status: "payment" }, u), f);
    case "rejected-returned":
      return listing(title, await loadClaims({ ...f, status: "returned" }, u), f);
    case "monthly-paid": {
      const claims = await loadClaims({ ...f, status: "paid" }, u);
      return {
        title, subtitle: periodText(f),
        headers: ["Claim Ref", "Claim Month", "Employee ID", "Employee", "Branch", "Payment Batch", "Payment Date", "Method", "Reference", "Paid (RM)"],
        rows: claims.map((c) => {
          const b = c.paymentItem?.batch;
          return [c.ref, `${c.claimYear}-${String(c.claimMonth).padStart(2, "0")}`, c.claimant.employeeNo, c.claimant.name, c.claimant.branch?.name ?? "", b?.ref ?? "", ymdOf(b?.paymentDate), b?.method ?? "", c.paymentItem?.paymentRef ?? b?.bankRef ?? "", toDecimal(c.paymentItem?.amountSen)];
        }),
        money: [9], totals: true,
      };
    }
    case "monthly-staff": {
      const claims = await loadClaims(f, u);
      const g = groupSum(
        claims,
        (c) => `${c.claimYear}-${String(c.claimMonth).padStart(2, "0")}|${c.claimant.employeeNo}|${c.claimant.name}|${c.claimant.branch?.name ?? ""}`,
        [() => 1, (c) => submittedTotal(c.lines), (c) => c.lines.reduce((a, l) => a + ver(l), 0), (c) => (APPROVED.has(c.status) ? reimbursable(c.lines, c.advanceSen) : 0), (c) => (c.status === "PAID" ? c.paymentItem?.amountSen ?? 0 : 0), (c) => (APPROVED.has(c.status) && c.status !== "PAID" ? reimbursable(c.lines, c.advanceSen) : 0)],
      );
      return {
        title, subtitle: periodText(f),
        headers: ["Month", "Employee ID", "Employee", "Branch", "Claims", "Submitted (RM)", "Verified (RM)", "Approved (RM)", "Paid (RM)", "Outstanding (RM)"],
        rows: g.map(([k, v]) => [...k.split("|"), v[0], toDecimal(v[1]), toDecimal(v[2]), toDecimal(v[3]), toDecimal(v[4]), toDecimal(v[5])]),
        money: [5, 6, 7, 8, 9], totals: true,
      };
    }
    case "employee": {
      const claims = await loadClaims(f, u);
      return {
        title: f.claimantId ? `${title} — ${claims[0]?.claimant.name ?? ""}` : `${title} (choose an employee filter for one person)`,
        subtitle: periodText(f),
        headers: ["Claim Ref", "Line", "Expense Date", "Category", "Supplier", "Description", "Claimed (RM)", "Verified (RM)", "Line Status", "Claim Status", "Paid On"],
        rows: claims.flatMap((c) => c.lines.map((l) => [c.ref, l.lineNo, ymdOf(l.expenseDate), l.category.name, l.supplier, l.description, toDecimal(l.amountSen), l.finStatus === "VERIFIED" ? toDecimal(ver(l)) : null, l.finStatus, STATUS_LABEL[c.status], c.paymentItem?.batch.status === "POSTED" ? ymdOf(c.paymentItem.batch.paymentDate) : ""])),
        money: [6, 7], totals: true,
      };
    }
    case "branch":
    case "by-category":
    case "accounting":
    case "by-period":
    case "by-payment-date": {
      const lines = await prisma.claimLine.findMany({
        where: lineWhere(f, u),
        include: { category: true, branch: true, claim: { include: { claimant: { include: { branch: true } }, company: true, paymentItem: { include: { batch: true } } } } },
        orderBy: [{ claim: { ref: "asc" } }, { lineNo: "asc" }],
      });
      const approvedAmt = (l: (typeof lines)[number]) => (APPROVED.has(l.claim.status) ? ver(l) : 0);
      const paidAmt = (l: (typeof lines)[number]) => (l.claim.status === "PAID" ? ver(l) : 0);
      if (key === "accounting") {
        return {
          title, subtitle: `${periodText(f)} · amounts are per expense line; advances are deducted at claim level`,
          headers: ["Claim Reference", "Claim Month", "Company", "Employee ID", "Employee Name", "Branch", "Expense Category", "GL Account Code", "Expense Date", "Supplier", "Description", "Receipt / Invoice No.", "Claim Amount", "Verified Amount", "Approved Amount", "Payment Date", "Payment Reference", "Payment Batch", "Payment Status", "Supporting Document Link"],
          rows: lines.map((l) => {
            const b = l.claim.paymentItem?.batch.status === "POSTED" ? l.claim.paymentItem.batch : null;
            return [
              l.claim.ref, `${l.claim.claimYear}-${String(l.claim.claimMonth).padStart(2, "0")}`, l.claim.company.name, l.claim.claimant.employeeNo, l.claim.claimant.name,
              l.branch.name, l.category.name, l.category.glAccountCode ?? "", ymdOf(l.expenseDate), l.supplier, l.description, l.receiptNo ?? l.invoiceNo ?? "",
              toDecimal(l.amountSen), l.finStatus === "VERIFIED" ? toDecimal(ver(l)) : null, APPROVED.has(l.claim.status) ? toDecimal(ver(l)) : null,
              b ? ymdOf(b.paymentDate) : "", b ? l.claim.paymentItem?.paymentRef ?? b.bankRef ?? "" : "", b?.ref ?? "", l.claim.status === "PAID" ? "Paid" : APPROVED.has(l.claim.status) ? "Unpaid" : STATUS_LABEL[l.claim.status],
              l.claim.driveFolderUrl ?? "",
            ];
          }),
          money: [12, 13, 14], totals: true,
          pdfColumns: [0, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 18],
        };
      }
      if (key === "by-payment-date") {
        const paid = lines.filter((l) => l.claim.status === "PAID");
        const g = groupSum(paid, (l) => `${ymdOf(l.claim.paymentItem?.batch.paymentDate)}|${l.claim.paymentItem?.batch.ref ?? ""}|${l.category.glAccountCode ?? ""}|${l.category.name}`, [() => 1, (l) => paidAmt(l)]);
        return { title, subtitle: periodText(f), headers: ["Payment Date", "Batch", "GL Code", "Category", "Lines", "Paid (RM)"], rows: g.map(([k, v]) => [...k.split("|"), v[0], toDecimal(v[1])]), money: [5], totals: true };
      }
      if (key === "by-period") {
        const fyEnd = (await getSettings()).financialYearEndMonth;
        const fy = (y: number, m: number) => (m > fyEnd ? `FY${y + 1}` : `FY${y}`);
        const g = groupSum(lines, (l) => `${fy(l.claim.claimYear, l.claim.claimMonth)}|${l.claim.claimYear}-${String(l.claim.claimMonth).padStart(2, "0")}|${l.claim.company.name}`, [() => 1, (l) => l.amountSen, (l) => ver(l), (l) => approvedAmt(l), (l) => paidAmt(l)]);
        return { title, subtitle: `Financial year ends month ${fyEnd} (configurable)`, headers: ["Financial Year", "Accounting Period", "Company", "Lines", "Claimed (RM)", "Verified (RM)", "Approved (RM)", "Paid (RM)"], rows: g.map(([k, v]) => [...k.split("|"), v[0], toDecimal(v[1]), toDecimal(v[2]), toDecimal(v[3]), toDecimal(v[4])]), money: [4, 5, 6, 7], totals: true };
      }
      const byCat = key === "by-category";
      const g = groupSum(lines, (l) => (byCat ? `${l.category.glAccountCode ?? ""}|${l.category.name}` : `${l.branch.name}|${l.claim.company.name}`), [() => 1, (l) => l.amountSen, (l) => ver(l), (l) => approvedAmt(l), (l) => paidAmt(l)]);
      return {
        title, subtitle: periodText(f),
        headers: [byCat ? "GL Code" : "Branch", byCat ? "Category" : "Company", "Lines", "Claimed (RM)", "Verified (RM)", "Approved (RM)", "Paid (RM)"],
        rows: g.map(([k, v]) => [...k.split("|"), v[0], toDecimal(v[1]), toDecimal(v[2]), toDecimal(v[3]), toDecimal(v[4])]),
        money: [3, 4, 5, 6], totals: true,
      };
    }
  }
}
