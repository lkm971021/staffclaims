import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Empty, Money, StatusBadge } from "@/components/ui";
import { monthLabel, nowMY } from "@/lib/time";
import { submittedTotal, reimbursable } from "@/lib/workflow";

export const metadata = { title: "Claim history" };

export default async function History({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const u = await requireRole("STAFF");
  const year = Number((await searchParams).year) || nowMY().year;
  const claims = await prisma.claim.findMany({
    where: { claimantId: u.id, claimYear: year },
    include: { lines: { select: { amountSen: true, finStatus: true, verifiedAmountSen: true } }, paymentItem: { include: { batch: true } } },
    orderBy: [{ claimMonth: "desc" }, { ref: "desc" }],
  });
  const years = await prisma.claim.findMany({ where: { claimantId: u.id }, distinct: ["claimYear"], select: { claimYear: true }, orderBy: { claimYear: "desc" } });
  const paid = claims.filter((c) => c.status === "PAID").reduce((a, c) => a + (c.paymentItem?.amountSen ?? 0), 0);
  return (
    <AppShell user={u}>
      <PageTitle title="Claim history" sub={<>Paid in {year}: <Money sen={paid} /></>} actions={
        <div className="flex gap-1">{(years.length ? years : [{ claimYear: year }]).map((y) => (
          <Link key={y.claimYear} href={`/staff/claims?year=${y.claimYear}`} className={`btn-sm ${y.claimYear === year ? "btn-primary" : "btn-ghost"}`}>{y.claimYear}</Link>
        ))}</div>
      } />
      {claims.length === 0 ? <Empty>No claims for {year}.</Empty> : null}
      <ul className="space-y-2">
        {claims.map((c) => (
          <li key={c.id}>
            <Link href={`/staff/claims/${c.id}`} className="card flex items-center gap-3 p-4 hover:border-gray-400">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.ref}</span><StatusBadge status={c.status} /></div>
                <div className="text-sm text-gray-500">{monthLabel(c.claimYear, c.claimMonth)} · {c.lines.length} expenses</div>
              </div>
              <Money sen={["APPROVED_FOR_PAYMENT", "PAID"].includes(c.status) ? reimbursable(c.lines, c.advanceSen) : submittedTotal(c.lines)} className="font-semibold" />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
