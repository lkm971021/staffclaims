import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { FilterBar } from "@/components/filter-bar";
import { PageTitle, Money, StatusBadge, Empty, Chip } from "@/components/ui";
import { parseFilters, claimWhere, toQuery } from "@/lib/filters";
import { monthLabel, fmtDate } from "@/lib/time";
import { reimbursable, submittedTotal } from "@/lib/workflow";

export const metadata = { title: "Claim register" };
const PAGE = 100;

export default async function Register({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("FINANCE");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const where = claimWhere(f, u);
  const [total, claims] = await Promise.all([
    prisma.claim.count({ where }),
    prisma.claim.findMany({
      where,
      include: {
        claimant: { include: { branch: true } },
        company: true,
        lines: { select: { amountSen: true, finStatus: true, verifiedAmountSen: true, hardcopyReceivedAt: true, duplicateFlags: { where: { decision: "OPEN" }, select: { id: true } } } },
        paymentItem: { include: { batch: true } },
      },
      orderBy: [{ claimYear: "desc" }, { claimMonth: "desc" }, { ref: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
  ]);
  const q = toQuery(f);
  const sumSub = claims.reduce((a, c) => a + submittedTotal(c.lines), 0);
  return (
    <AppShell user={u} wide>
      <PageTitle
        title="Master claim register"
        sub={`${total} claim${total === 1 ? "" : "s"} match`}
        actions={
          <>
            <a className="btn-ghost btn-sm" href={`/api/exports/register?format=xlsx&${q}`}>Excel</a>
            <a className="btn-ghost btn-sm" href={`/api/exports/register?format=csv&${q}`}>CSV</a>
            <a className="btn-ghost btn-sm" href={`/api/exports/register?format=pdf&${q}`} target="_blank">PDF</a>
            <a className="btn-ghost btn-sm" href={`/api/exports/zip?${q}`}>Documents ZIP</a>
          </>
        }
      />
      <FilterBar f={f} action="/finance/claims" viewer={u} show={["year", "month", "employee", "branch", "company", "category", "status", "payment", "q"]} />
      {claims.length === 0 ? <Empty>No claims match these filters.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">Reference</th><th className="th">Month</th><th className="th">Employee</th><th className="th">Branch</th><th className="th">Company</th>
                <th className="th">Status</th><th className="th">Submitted</th><th className="th text-right">Claimed</th><th className="th text-right">Verified</th><th className="th">Payment</th><th className="th">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {claims.map((c) => {
                const ver = c.lines.some((l) => l.finStatus !== "PENDING");
                const dup = c.lines.reduce((a, l) => a + l.duplicateFlags.length, 0);
                const noHard = ["PENDING_DIRECTOR", "APPROVED_FOR_PAYMENT", "PAID"].includes(c.status) && c.lines.some((l) => l.finStatus === "VERIFIED" && !l.hardcopyReceivedAt);
                const pb = c.paymentItem?.batch;
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="td"><Link href={`/finance/claims/${c.id}`} className="font-semibold text-blue-700 underline">{c.ref}</Link>{c.version > 1 ? <span className="ml-1 text-xs text-gray-400">v{c.version}</span> : null}</td>
                    <td className="td">{monthLabel(c.claimYear, c.claimMonth)}</td>
                    <td className="td">{c.claimant.employeeNo} · {c.claimant.name}</td>
                    <td className="td">{c.claimant.branch?.name}</td>
                    <td className="td text-xs">{c.company.code}</td>
                    <td className="td"><StatusBadge status={c.status} /></td>
                    <td className="td text-gray-500">{fmtDate(c.submittedAt)}</td>
                    <td className="td text-right"><Money sen={submittedTotal(c.lines)} /></td>
                    <td className="td text-right">{ver ? <Money sen={reimbursable(c.lines, c.advanceSen)} /> : "-"}</td>
                    <td className="td text-xs">{pb ? `${pb.ref}${pb.status === "POSTED" ? ` · ${fmtDate(pb.paymentDate, true)}` : " (draft)"}` : ""}</td>
                    <td className="td">
                      {dup ? <Chip tone="red">{dup} dup</Chip> : null} {noHard ? <Chip tone="amber">no hard copy</Chip> : null} {c.archiveStatus !== "ARCHIVED" ? <Chip tone="gray">{c.archiveStatus === "FAILED" ? "archive failed" : "archiving"}</Chip> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50"><tr><td className="td font-semibold" colSpan={7}>Total on this page</td><td className="td text-right font-semibold"><Money sen={sumSub} /></td><td colSpan={3} /></tr></tfoot>
          </table>
        </div>
      )}
      {total > PAGE ? (
        <div className="mt-3 flex justify-center gap-2">
          {page > 1 ? <Link className="btn-ghost btn-sm" href={`/finance/claims?${toQuery(f, { page: String(page - 1) })}`}>← Previous</Link> : null}
          <span className="px-2 py-1 text-sm text-gray-500">Page {page} of {Math.ceil(total / PAGE)}</span>
          {page * PAGE < total ? <Link className="btn-ghost btn-sm" href={`/finance/claims?${toQuery(f, { page: String(page + 1) })}`}>Next →</Link> : null}
        </div>
      ) : null}
    </AppShell>
  );
}
