import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { FilterBar } from "@/components/filter-bar";
import { PageTitle, Empty, Money, Chip } from "@/components/ui";
import { parseFilters, claimWhere } from "@/lib/filters";
import { reimbursable } from "@/lib/workflow";
import { fmtDate, fmtDateTime, monthLabel } from "@/lib/time";
import { buckets } from "@/lib/stats";
import { BatchSelector } from "./batch-selector";

export const metadata = { title: "Payments" };

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("FINANCE");
  const f = parseFilters(await searchParams);
  const [approved, batches, b] = await Promise.all([
    prisma.claim.findMany({
      where: { AND: [claimWhere({ ...f, status: "payment" }, u), { paymentItem: null }] },
      include: { claimant: true, company: true, lines: { select: { amountSen: true, finStatus: true, verifiedAmountSen: true } }, events: { where: { action: { in: ["DIRECTOR_APPROVE", "FINANCE_VERIFY"] } }, orderBy: { at: "desc" }, take: 1 } },
      orderBy: [{ companyId: "asc" }, { claimYear: "asc" }, { claimMonth: "asc" }, { ref: "asc" }],
    }),
    prisma.paymentBatch.findMany({
      where: { items: { some: { claim: { claimant: { isDemo: u.isDemo } } } } },
      include: { company: true, items: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    buckets(f, u),
  ]);
  return (
    <AppShell user={u} wide>
      <PageTitle title="Payment processing" sub="Only Director-approved claims (or Director's own claims after Finance verification) can be paid. The app records payments only — it does not make bank transfers." />
      <FilterBar f={f} action="/finance/payments" viewer={u} show={["year", "month", "employee", "branch", "company", "category"]} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><div className="text-xs font-semibold uppercase text-gray-500">Approved, unpaid</div><div className="text-xl font-bold"><Money sen={b.approvedUnpaid.sen} /></div><div className="text-xs text-gray-500">{b.approvedUnpaid.n} claims</div></div>
        <div className="card p-4"><div className="text-xs font-semibold uppercase text-gray-500">Paid</div><div className="text-xl font-bold text-emerald-700"><Money sen={b.paid.sen} /></div><div className="text-xs text-gray-500">{b.paid.n} claims</div></div>
        <div className="card p-4"><div className="text-xs font-semibold uppercase text-gray-500">Pending Director</div><div className="text-xl font-bold text-violet-700"><Money sen={b.pendingDirector.sen} /></div><div className="text-xs text-gray-500">{b.pendingDirector.n} claims</div></div>
        <div className="card p-4"><div className="text-xs font-semibold uppercase text-gray-500">Pending Finance</div><div className="text-xl font-bold text-blue-700"><Money sen={b.pendingFinance.sen} /></div><div className="text-xs text-gray-500">{b.pendingFinance.n} claims</div></div>
      </div>

      <h2 className="mb-2 font-bold">Ready for payment (not yet in a batch)</h2>
      {approved.length === 0 ? <Empty>No approved claims waiting for payment.</Empty> : (
        <BatchSelector
          rows={approved.map((c) => ({
            id: c.id, ref: c.ref, company: c.company.name, companyId: c.companyId, claimant: `${c.claimant.employeeNo} · ${c.claimant.name}`,
            month: monthLabel(c.claimYear, c.claimMonth), amountSen: reimbursable(c.lines, c.advanceSen), approvedAt: fmtDateTime(c.events[0]?.at),
            own: c.isDirectorOwnClaim,
          }))}
        />
      )}

      <h2 className="mb-2 mt-6 font-bold">Payment batches</h2>
      {batches.length === 0 ? <Empty>No payment batches yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50"><tr><th className="th">Batch</th><th className="th">Company</th><th className="th">Status</th><th className="th">Payment date</th><th className="th">Method</th><th className="th">Reference</th><th className="th text-right">Claims</th><th className="th text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {batches.map((x) => (
                <tr key={x.id} className="hover:bg-gray-50">
                  <td className="td"><Link className="font-semibold text-blue-700 underline" href={`/finance/payments/${x.id}`}>{x.ref}</Link></td>
                  <td className="td">{x.company.code}</td>
                  <td className="td"><Chip tone={x.status === "POSTED" ? "green" : x.status === "DRAFT" ? "amber" : "gray"}>{x.status === "POSTED" ? "Paid" : x.status}</Chip></td>
                  <td className="td">{fmtDate(x.paymentDate, true)}</td>
                  <td className="td">{x.method}</td>
                  <td className="td">{x.bankRef}</td>
                  <td className="td text-right">{x.items.length}</td>
                  <td className="td text-right"><Money sen={x.items.reduce((a, i) => a + i.amountSen, 0)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
