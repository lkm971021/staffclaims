import { prisma } from "@/lib/db";
import type { ClaimFilters } from "@/lib/filters";
import { STATUS_GROUPS } from "@/lib/filters";
import { STATUS_LABEL } from "@/lib/workflow";
import { MONTHS_LONG, nowMY } from "@/lib/time";
import type { SessionUser } from "@/lib/rbac";

/** GET-form filter bar (works without JavaScript; filters are kept in the URL so views can be bookmarked). */
export async function FilterBar({ f, action, viewer, show = ["year", "month", "employee", "branch", "category", "status", "payment", "q"], hidden = {} }: {
  f: ClaimFilters; action: string; viewer: SessionUser; show?: string[]; hidden?: Record<string, string>;
}) {
  const [staff, branches, cats, companies] = await Promise.all([
    prisma.user.findMany({ where: { isDemo: viewer.isDemo, roles: { has: "STAFF" } }, orderBy: { name: "asc" }, select: { id: true, name: true, employeeNo: true } }),
    prisma.branch.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.expenseCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.company.findMany({ orderBy: { name: "asc" } }),
  ]);
  const y = nowMY().year;
  const years = Array.from({ length: 6 }, (_, i) => y - i);
  const sel = "input !py-2 !text-sm";
  return (
    <form action={action} method="get" className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-8">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {show.includes("year") ? (
        <select name="year" defaultValue={f.year ?? ""} className={sel} aria-label="Year">
          <option value="">All years</option>
          {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
        </select>
      ) : null}
      {show.includes("month") ? (
        <select name="month" defaultValue={f.month ?? ""} className={sel} aria-label="Claim month">
          <option value="">All months</option>
          {MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      ) : null}
      {show.includes("employee") ? (
        <select name="employee" defaultValue={f.claimantId ?? ""} className={sel} aria-label="Employee">
          <option value="">All staff</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.employeeNo} {s.name}</option>)}
        </select>
      ) : null}
      {show.includes("branch") ? (
        <select name="branch" defaultValue={f.branchId ?? ""} className={sel} aria-label="Branch">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      ) : null}
      {show.includes("company") ? (
        <select name="company" defaultValue={f.companyId ?? ""} className={sel} aria-label="Company">
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : null}
      {show.includes("category") ? (
        <select name="category" defaultValue={f.categoryId ?? ""} className={sel} aria-label="Category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : null}
      {show.includes("status") ? (
        <select name="status" defaultValue={f.status ?? ""} className={sel} aria-label="Status">
          <option value="">All statuses</option>
          <optgroup label="Queues">
            {Object.entries(STATUS_GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
            <option value="duplicates">Possible duplicates (open)</option>
            <option value="hardcopy">Hard copy not received</option>
            <option value="archive">Drive archive pending / failed</option>
          </optgroup>
          <optgroup label="Status">
            {Object.entries(STATUS_LABEL).filter(([k]) => k !== "DRAFT").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </optgroup>
        </select>
      ) : null}
      {show.includes("payment") ? (
        <select name="payment" defaultValue={f.payment ?? ""} className={sel} aria-label="Payment status">
          <option value="">Any payment status</option>
          <option value="UNPAID">Approved, unpaid</option>
          <option value="PAID">Paid</option>
        </select>
      ) : null}
      {show.includes("q") ? <input name="q" defaultValue={f.q ?? ""} placeholder="Search ref / name / supplier / receipt no." className={`${sel} col-span-2`} /> : null}
      <div className="col-span-2 flex gap-2 sm:col-span-1">
        <button className="btn-primary btn-sm flex-1">Apply</button>
        <a href={action} className="btn-ghost btn-sm">Clear</a>
      </div>
    </form>
  );
}
