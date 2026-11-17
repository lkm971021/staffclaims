import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { FilterBar } from "@/components/filter-bar";
import { PageTitle } from "@/components/ui";
import { parseFilters, toQuery } from "@/lib/filters";
import { buildReport, REPORTS, type ReportKey } from "@/lib/reports";
import { nowMY, prevMonth } from "@/lib/time";

export const metadata = { title: "Reports" };

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("FINANCE");
  const sp = await searchParams;
  const type = (sp.type && sp.type in REPORTS ? sp.type : "monthly-staff") as ReportKey;
  const f = parseFilters(sp);
  if (!sp.year && !sp.month) {
    const p = prevMonth(nowMY().year, nowMY().month);
    Object.assign(f, { year: p.year, month: p.month });
  }
  const t = await buildReport(type, f, u);
  const q = toQuery(f, { type });
  const preview = t.rows.slice(0, 200);
  const fmt = (v: unknown, i: number) =>
    v === null || v === undefined ? "" : t.money?.includes(i) && typeof v === "number" ? v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
  return (
    <AppShell user={u} wide>
      <PageTitle title="Reports & exports" sub="Every report can be downloaded as Excel, CSV or PDF. Exports are recorded in the audit log." />
      <div className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(REPORTS) as ReportKey[]).map((k) => (
          <Link key={k} href={`/finance/reports?${toQuery(f, { type: k })}`} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${k === type ? "bg-gray-900 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
            {REPORTS[k]}
          </Link>
        ))}
      </div>
      <FilterBar f={f} action={`/finance/reports`} viewer={u} show={["year", "month", "employee", "branch", "company", "category", "status", "payment"]} hidden={{ type }} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="font-bold">{t.title}</div>
          <div className="text-xs text-gray-500">{t.subtitle} · {t.rows.length} rows</div>
        </div>
        <a className="btn-primary btn-sm" href={`/api/exports/report?format=xlsx&${q}`}>Excel</a>
        <a className="btn-ghost btn-sm" href={`/api/exports/report?format=csv&${q}`}>CSV</a>
        <a className="btn-ghost btn-sm" href={`/api/exports/report?format=pdf&${q}`} target="_blank">PDF</a>
        <a className="btn-ghost btn-sm" href={`/api/exports/zip?${toQuery(f)}`}>All documents (ZIP)</a>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50"><tr>{t.headers.map((h, i) => <th key={i} className={`th ${t.money?.includes(i) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {preview.map((r, k) => (
              <tr key={k}>{r.map((v, i) => <td key={i} className={`td !text-xs ${t.money?.includes(i) ? "text-right num" : ""}`}>{fmt(v, i)}</td>)}</tr>
            ))}
            {t.totals && t.money?.length && t.rows.length ? (
              <tr className="bg-gray-50 font-bold">
                {t.headers.map((_, i) => (
                  <td key={i} className={`td !text-xs ${t.money?.includes(i) ? "text-right num" : ""}`}>
                    {i === 0 ? "TOTAL" : t.money!.includes(i) ? fmt(t.rows.reduce((a, r) => a + (typeof r[i] === "number" ? (r[i] as number) : 0), 0), i) : ""}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
        {t.rows.length > preview.length ? <div className="p-3 text-xs text-gray-500">Showing the first {preview.length} rows — download for the full report.</div> : null}
        {t.rows.length === 0 ? <div className="p-6 text-center text-sm text-gray-500">No data for these filters.</div> : null}
      </div>
    </AppShell>
  );
}
