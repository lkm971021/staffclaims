import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { FilterBar } from "@/components/filter-bar";
import { PageTitle, Money, Alert, StatusBadge } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { parseFilters, claimWhere, toQuery } from "@/lib/filters";
import { buckets, reconciliation } from "@/lib/stats";
import { getSettings } from "@/lib/settings";
import { fmtDate, monthLabel, nowMY, prevMonth, submissionDeadline, paymentTargetDate, fmtDateTime } from "@/lib/time";
import { rm } from "@/lib/money";

export const metadata = { title: "Finance" };

export default async function FinanceHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("FINANCE");
  const sp = await searchParams;
  const now = nowMY();
  const def = prevMonth(now.year, now.month);
  const f = parseFilters(sp);
  if (!sp.year && !sp.month) Object.assign(f, { year: def.year, month: def.month });
  const s = await getSettings();
  const [b, recon, queues, recent] = await Promise.all([
    buckets(f, u),
    reconciliation(f, u),
    Promise.all([
      prisma.claim.count({ where: claimWhere({ status: "finance" }, u) }),
      prisma.claim.count({ where: claimWhere({ status: "director" }, u) }),
      prisma.claim.count({ where: claimWhere({ status: "payment" }, u) }),
      prisma.claim.count({ where: claimWhere({ status: "duplicates" }, u) }),
      prisma.claim.count({ where: claimWhere({ status: "hardcopy" }, u) }),
      prisma.claim.count({ where: claimWhere({ status: "archive" }, u) }),
    ]),
    prisma.claim.findMany({
      where: claimWhere({ status: "finance" }, u),
      include: { claimant: true, lines: { select: { amountSen: true, warnings: true, duplicateFlags: { where: { decision: "OPEN" }, select: { id: true } } } } },
      orderBy: { submittedAt: "asc" },
      take: 12,
    }),
  ]);
  const [qFin, qDir, qPay, qDup, qHard, qArch] = queues;
  const period = f.year && f.month ? monthLabel(f.year, f.month) : f.year ? String(f.year) : "All periods";
  const deadline = f.year && f.month ? submissionDeadline(f.year, f.month, s.submissionDeadlineDay) : null;
  const payDate = f.year && f.month ? paymentTargetDate(f.year, f.month, s.paymentTargetDay) : null;

  // overdue: staff with drafts/returned claims for the period after the deadline
  const overdue = deadline && new Date() > deadline
    ? await prisma.claim.findMany({ where: { claimYear: f.year, claimMonth: f.month, status: { in: ["DRAFT", "RETURNED"] }, claimant: { isDemo: u.isDemo }, lines: { some: {} } }, include: { claimant: true } })
    : [];

  const rows: [string, { n: number; sen: number }, string, string?][] = [
    ["Total claims submitted", b.submitted, ""],
    ["Pending Finance verification", b.pendingFinance, "finance", "text-blue-700"],
    ["Pending Director approval", b.pendingDirector, "director", "text-violet-700"],
    ["Finance verified (cumulative)", b.financeVerified, ""],
    ["Director approved (cumulative)", b.directorApproved, ""],
    ["Approved but unpaid", b.approvedUnpaid, "payment", "text-teal-700"],
    ["Total paid", b.paid, "paid", "text-emerald-700"],
    ["Returned / rejected", b.returnedRejected, "returned", "text-red-700"],
  ];

  const pendingLabel = f.year && f.month ? monthLabel(f.year, f.month) : "this month";
  const templates = [
    {
      title: "Submission reminder (staff group)",
      text: `Hi all, friendly reminder 😊 Please submit your ${pendingLabel} claims in the Staff Claims app${deadline ? ` by ${fmtDate(deadline)}` : ""}. Attach clear photos of every receipt / invoice and state the business purpose. Payment will be arranged by ${payDate ? fmtDate(payDate) : "the 16th"}, subject to verification and Director approval. Thank you!`,
    },
    {
      title: "Returned claim follow-up (individual)",
      text: `Hi, your claim has been returned for correction in the Staff Claims app. Please open it, check Finance's comments, update the details / documents and resubmit. Thank you!`,
    },
    {
      title: "Payment completed (staff group)",
      text: `Hi all, ${pendingLabel} claims that were verified and approved have been paid. You can check the payment date and reference under "My Claims" in the app. Thank you!`,
    },
    {
      title: "Director approval request",
      text: `Hi, ${qDir} claim(s) have been verified by Finance and are waiting for your approval in the Staff Claims app (Approvals). Thank you!`,
    },
  ];

  return (
    <AppShell user={u} wide>
      <PageTitle
        title="Finance dashboard"
        sub={<>Monthly payment control · {period}{deadline ? <> · submission deadline {fmtDate(deadline)} · payment target {fmtDate(payDate)}</> : null}</>}
        actions={<Link href="/finance/payments" className="btn-primary btn-sm">Payment processing</Link>}
      />
      <FilterBar f={f} action="/finance" viewer={u} show={["year", "month", "branch", "employee", "category", "company"]} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Awaiting verification", qFin, "finance"],
          ["Awaiting Director", qDir, "director"],
          ["Ready for payment", qPay, "payment"],
          ["Open duplicate flags", qDup, "duplicates"],
          ["Hard copy not received", qHard, "hardcopy"],
          ["Drive archive pending", qArch, "archive"],
        ].map(([label, n, k]) => (
          <Link key={k as string} href={`/finance/claims?status=${k}`} className={`card p-4 hover:border-gray-400 ${n && ["finance", "duplicates"].includes(k as string) ? "border-blue-300" : ""}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-bold">{n as number}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="card overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3 font-semibold">Monthly payment control — {period}</div>
            <table className="w-full">
              <thead className="bg-gray-50"><tr><th className="th">Description</th><th className="th text-right">Claims</th><th className="th text-right">Amount (RM)</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(([label, v, k, tone]) => (
                  <tr key={label}>
                    <td className="td">{k ? <Link className="underline decoration-gray-300 hover:decoration-gray-900" href={`/finance/claims?${toQuery({ ...f, status: k })}`}>{label}</Link> : label}</td>
                    <td className="td text-right num">{v.n}</td>
                    <td className={`td text-right font-semibold num ${tone ?? ""}`}>{rm(v.sen).replace("RM ", "")}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <td className="td">Finance adjustments (claimed − verified) · Advances deducted</td>
                  <td className="td text-right num">{b.adjustments.n} · {b.advances.n}</td>
                  <td className="td text-right num">{rm(b.adjustments.sen).replace("RM ", "")} · {rm(b.advances.sen).replace("RM ", "")}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 mt-5 font-bold">Verification queue (oldest first)</h2>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50"><tr><th className="th">Ref</th><th className="th">Staff</th><th className="th">Month</th><th className="th">Submitted</th><th className="th">Flags</th><th className="th text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {recent.map((c) => {
                  const warn = c.lines.reduce((a, l) => a + ((l.warnings as unknown[]) ?? []).length, 0);
                  const dup = c.lines.reduce((a, l) => a + l.duplicateFlags.length, 0);
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="td"><Link className="font-semibold text-blue-700 underline" href={`/finance/claims/${c.id}`}>{c.ref}</Link> {c.status === "CLARIFICATION" ? <StatusBadge status={c.status} /> : null}</td>
                      <td className="td">{c.claimant.name}</td>
                      <td className="td">{monthLabel(c.claimYear, c.claimMonth)}</td>
                      <td className="td text-gray-500">{fmtDateTime(c.submittedAt)}</td>
                      <td className="td">{dup ? <span className="chip bg-red-50 text-red-700">{dup} duplicate</span> : null} {warn ? <span className="chip bg-amber-50 text-amber-800">{warn} warning</span> : null}</td>
                      <td className="td text-right"><Money sen={c.lines.reduce((a, l) => a + l.amountSen, 0)} /></td>
                    </tr>
                  );
                })}
                {recent.length === 0 ? <tr><td className="td text-gray-500" colSpan={6}>Nothing waiting. 🎉</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="card p-4">
            <div className="mb-2 font-semibold">Reconciliation checks</div>
            {recon.length === 0 ? <Alert tone="green">Submitted, verified, approved and paid figures agree for this period.</Alert> : (
              <ul className="space-y-2 text-sm">
                {recon.map((w, i) => (
                  <li key={i} className={`rounded-lg px-3 py-2 ${w.level === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                    {w.href ? <Link href={w.href} className="underline">{w.message}</Link> : w.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {overdue.length ? (
            <div className="card p-4">
              <div className="mb-2 font-semibold">Overdue — not submitted after the deadline</div>
              <ul className="space-y-1 text-sm">
                {overdue.map((c) => <li key={c.id}>{c.claimant.name} · {c.ref} · {c.status === "RETURNED" ? "returned, not resubmitted" : "draft"}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="card p-4">
            <div className="mb-1 font-semibold">WhatsApp message templates</div>
            <div className="mb-3 text-xs text-gray-500">Copy and send manually. The app does not send WhatsApp messages.</div>
            <div className="space-y-3">
              {templates.map((t) => (
                <div key={t.title} className="rounded-xl border border-gray-200 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2"><div className="text-sm font-semibold">{t.title}</div><CopyButton text={t.text} /></div>
                  <div className="text-xs text-gray-600">{t.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
