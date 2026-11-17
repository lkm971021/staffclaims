import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { FilterBar } from "@/components/filter-bar";
import { PageTitle, Stat } from "@/components/ui";
import { TrendChart, RankBars } from "@/components/charts";
import { parseFilters } from "@/lib/filters";
import { buckets } from "@/lib/stats";
import { MONTHS_SHORT, nowMY, prevMonth } from "@/lib/time";
import { rm } from "@/lib/money";

export const metadata = { title: "Management overview" };

/** Internal Finance / management only. Approved = Director-approved or paid (verified amounts). */
export default async function Management({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("FINANCE", "DIRECTOR");
  const sp = await searchParams;
  const now = nowMY();
  const def = prevMonth(now.year, now.month);
  const f = parseFilters(sp);
  if (!sp.year && !sp.month) Object.assign(f, { year: def.year, month: def.month });
  const year = f.year ?? def.year;
  const month = f.month ?? 12;

  const lines = await prisma.claimLine.findMany({
    where: {
      finStatus: "VERIFIED",
      claim: { status: { in: ["APPROVED_FOR_PAYMENT", "PAID"] }, claimant: { isDemo: u.isDemo }, claimYear: { in: [year - 2, year - 1, year] }, ...(f.companyId ? { companyId: f.companyId } : {}) },
      ...(f.branchId ? { branchId: f.branchId } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    },
    select: { amountSen: true, verifiedAmountSen: true, branch: { select: { name: true } }, category: { select: { name: true } }, claim: { select: { claimYear: true, claimMonth: true, claimantId: true, claimant: { select: { name: true } } } } },
  });
  const amt = (l: (typeof lines)[number]) => l.verifiedAmountSen ?? l.amountSen;
  const key = (y: number, m: number) => y * 100 + m;
  const byMonth = new Map<number, number>();
  for (const l of lines) byMonth.set(key(l.claim.claimYear, l.claim.claimMonth), (byMonth.get(key(l.claim.claimYear, l.claim.claimMonth)) ?? 0) + amt(l));
  // trailing 12 months ending at the selected month
  const trend: { label: string; cur: number; prev: number }[] = [];
  let y = year, m = month;
  for (let i = 0; i < 12; i++) {
    trend.unshift({ label: `${MONTHS_SHORT[m - 1].slice(0, 3)} ${String(y).slice(2)}`, cur: byMonth.get(key(y, m)) ?? 0, prev: byMonth.get(key(y - 1, m)) ?? 0 });
    ({ year: y, month: m } = prevMonth(y, m));
  }
  const inPeriod = lines.filter((l) => l.claim.claimYear === year && (!f.month || l.claim.claimMonth === f.month));
  const group = (k: (l: (typeof lines)[number]) => string) => {
    const g = new Map<string, number>();
    for (const l of inPeriod) g.set(k(l), (g.get(k(l)) ?? 0) + amt(l));
    return [...g.entries()].map(([label, sen]) => ({ label, sen }));
  };
  const total = inPeriod.reduce((a, l) => a + amt(l), 0);
  const staffCount = new Set(inPeriod.map((l) => l.claim.claimantId)).size;
  const cur = byMonth.get(key(year, month)) ?? 0;
  const pm = prevMonth(year, month);
  const mom = byMonth.get(key(pm.year, pm.month)) ?? 0;
  const yoy = byMonth.get(key(year - 1, month)) ?? 0;
  const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(0)}%` : "n/a");
  const ytd = [...byMonth.entries()].filter(([k]) => Math.floor(k / 100) === year && k % 100 <= month).reduce((a, [, v]) => a + v, 0);
  const ytdPrev = [...byMonth.entries()].filter(([k]) => Math.floor(k / 100) === year - 1 && k % 100 <= month).reduce((a, [, v]) => a + v, 0);
  const b = await buckets(f, u);
  const period = f.month ? `${MONTHS_SHORT[f.month - 1]} ${year}` : `${year}`;

  return (
    <AppShell user={u} wide>
      <PageTitle title="Management overview" sub="Internal — Finance and authorised management only. Expense figures use Director-approved / paid verified amounts." />
      <FilterBar f={f} action="/management" viewer={u} show={["year", "month", "branch", "company", "category"]} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label={`Approved ${period}`} value={rm(total)} sub={`${staffCount} staff`} />
        <Stat label="Avg per employee" value={rm(staffCount ? Math.round(total / staffCount) : 0)} />
        <Stat label="vs previous month" value={pct(cur, mom)} sub={rm(mom)} />
        <Stat label="vs same month last year" value={pct(cur, yoy)} sub={rm(yoy)} />
        <Stat label={`Year to date ${year}`} value={rm(ytd)} sub={`${pct(ytd, ytdPrev)} vs ${year - 1} YTD`} />
        <Stat label="Pending verification" value={rm(b.pendingFinance.sen)} sub={`${b.pendingFinance.n} claims`} />
        <Stat label="Approved, unpaid" value={rm(b.approvedUnpaid.sen)} sub={`${b.approvedUnpaid.n} claims`} />
        <Stat label="Rejected / returned" value={rm(b.returnedRejected.sen)} sub={`${b.returnedRejected.n} claims`} />
      </div>
      <div className="card mb-4 p-4">
        <div className="mb-1 font-semibold">Monthly approved reimbursements — 12 months to {MONTHS_SHORT[month - 1]} {year}</div>
        <TrendChart data={trend} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4"><div className="mb-2 font-semibold">By branch — {period}</div><RankBars data={group((l) => l.branch.name)} /></div>
        <div className="card p-4"><div className="mb-2 font-semibold">By category — {period}</div><RankBars data={group((l) => l.category.name)} /></div>
        <div className="card p-4"><div className="mb-2 font-semibold">By staff — {period}</div><RankBars data={group((l) => l.claim.claimant.name)} /></div>
      </div>
    </AppShell>
  );
}
