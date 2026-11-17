import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole, delegatedMemberIds } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/app-shell";
import { Alert, Empty, Money, StatusBadge } from "@/components/ui";
import { fmtDate, monthLabel, nowMY, prevMonth, submissionDeadline, paymentTargetDate } from "@/lib/time";
import { submittedTotal, reimbursable } from "@/lib/workflow";
import { NewClaimButton } from "./new-claim-button";

export const metadata = { title: "My Claims" };

export default async function StaffHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const u = await requireRole("STAFF");
  const { error } = await searchParams;
  const s = await getSettings();
  const now = nowMY();
  const prev = prevMonth(now.year, now.month);
  const prevDeadline = submissionDeadline(prev.year, prev.month, s.submissionDeadlineDay);
  const curDeadline = submissionDeadline(now.year, now.month, s.submissionDeadlineDay);
  const inPrevWindow = new Date() <= prevDeadline;

  const memberIds = await delegatedMemberIds(u.id);
  const members = memberIds.length ? await prisma.user.findMany({ where: { id: { in: memberIds } }, orderBy: { name: "asc" } }) : [];

  const claims = await prisma.claim.findMany({
    where: { claimantId: u.id },
    include: { lines: { select: { amountSen: true, finStatus: true, verifiedAmountSen: true } } },
    orderBy: [{ updatedAt: "desc" }],
    take: 100,
  });
  const by = (st: string[]) => claims.filter((c) => st.includes(c.status));
  const amt = (cs: typeof claims, verified = false) =>
    cs.reduce((a, c) => a + (verified ? reimbursable(c.lines, c.advanceSen) : submittedTotal(c.lines)), 0);
  const thisMonth = claims.filter((c) => c.claimYear === now.year && c.claimMonth === now.month && c.status !== "DRAFT");
  const returned = by(["RETURNED"]);
  const drafts = by(["DRAFT"]);

  const teamClaims = memberIds.length
    ? await prisma.claim.findMany({
        where: { claimantId: { in: memberIds }, submittedById: u.id },
        include: { claimant: true, lines: { select: { amountSen: true } } },
        orderBy: { updatedAt: "desc" },
        take: 20,
      })
    : [];

  const tiles = [
    { label: "Drafts", list: drafts, tone: "text-gray-900" },
    { label: "Returned – action needed", list: returned, tone: "text-amber-700" },
    { label: "Pending Finance", list: by(["PENDING_FINANCE", "CLARIFICATION"]), tone: "text-blue-700" },
    { label: "Pending Director", list: by(["PENDING_DIRECTOR"]), tone: "text-violet-700" },
    { label: "Approved (unpaid)", list: by(["APPROVED_FOR_PAYMENT"]), tone: "text-teal-700", verified: true },
    { label: "Paid", list: by(["PAID"]), tone: "text-emerald-700", verified: true },
  ];

  return (
    <AppShell user={u}>
      <div className="mb-5">
        <div className="text-sm text-gray-500">Welcome back,</div>
        <h1 className="text-2xl font-bold">{u.nickName || u.name}</h1>
        <div className="mt-1 text-sm text-gray-500">{u.branch?.name ?? "No branch assigned"} · Employee {u.employeeNo}</div>
      </div>

      {error ? <div className="mb-4"><Alert tone="red">{error}</Alert></div> : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {inPrevWindow ? (
          <Alert tone="amber" title={`${monthLabel(prev.year, prev.month)} claims due ${fmtDate(prevDeadline)}`}>
            Submit before the deadline. Payment target: {fmtDate(paymentTargetDate(prev.year, prev.month, s.paymentTargetDay))}, subject to verification and approval.
          </Alert>
        ) : null}
        <Alert tone="blue" title={`Current claim month: ${monthLabel(now.year, now.month)}`}>
          Submission deadline {fmtDate(curDeadline)} · target payment {fmtDate(paymentTargetDate(now.year, now.month, s.paymentTargetDay))}
        </Alert>
      </div>

      <NewClaimButton
        defaultMonth={`${(inPrevWindow ? prev : now).year}-${String((inPrevWindow ? prev : now).month).padStart(2, "0")}`}
        months={[now, prev, prevMonth(prev.year, prev.month)].map((m) => ({ value: `${m.year}-${String(m.month).padStart(2, "0")}`, label: monthLabel(m.year, m.month) }))}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        selfId={u.id}
      />

      {returned.length ? (
        <div className="mt-4 space-y-2">
          {returned.map((c) => (
            <Link key={c.id} href={`/staff/claims/${c.id}`} className="block rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="font-semibold text-amber-900">Action needed: {c.ref} was returned for correction</div>
              <div className="text-sm text-amber-800">{c.financeRemarks || "Open the claim to see Finance's comments."}</div>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="card col-span-2 p-4 lg:col-span-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Submitted for {monthLabel(now.year, now.month)}</div>
          <div className="mt-1 flex items-baseline gap-3"><span className="text-2xl font-bold">{thisMonth.length} claim{thisMonth.length === 1 ? "" : "s"}</span><Money sen={amt(thisMonth)} className="text-gray-600" /></div>
        </div>
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.label}</div>
            <div className={`mt-1 text-xl font-bold ${t.tone}`}>{t.list.length}</div>
            <Money sen={amt(t.list, t.verified)} className="text-xs text-gray-500" />
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">My claims</h2>
      {claims.length === 0 ? <Empty>No claims yet. Tap “+ New Expense Claim” to start.</Empty> : null}
      <ul className="space-y-2">
        {claims.map((c) => (
          <li key={c.id}>
            <Link href={`/staff/claims/${c.id}`} className="card flex items-center gap-3 p-4 hover:border-gray-400">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.ref}</span><StatusBadge status={c.status} /></div>
                <div className="text-sm text-gray-500">{monthLabel(c.claimYear, c.claimMonth)} · {c.lines.length} expense{c.lines.length === 1 ? "" : "s"}</div>
              </div>
              <Money sen={["APPROVED_FOR_PAYMENT", "PAID"].includes(c.status) ? reimbursable(c.lines, c.advanceSen) : submittedTotal(c.lines)} className="font-semibold" />
            </Link>
          </li>
        ))}
      </ul>

      {teamClaims.length ? (
        <>
          <h2 className="mb-2 mt-6 text-lg font-bold">Claims I submitted for my team</h2>
          <ul className="space-y-2">
            {teamClaims.map((c) => (
              <li key={c.id}>
                <Link href={`/staff/claims/${c.id}`} className="card flex items-center gap-3 p-4 hover:border-gray-400">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.ref}</span><StatusBadge status={c.status} /></div>
                    <div className="text-sm text-gray-500">{c.claimant.name} · {monthLabel(c.claimYear, c.claimMonth)}</div>
                  </div>
                  <Money sen={submittedTotal(c.lines)} className="font-semibold" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </AppShell>
  );
}
