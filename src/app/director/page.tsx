import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Empty, Money, StatusBadge } from "@/components/ui";
import { monthLabel, fmtDateTime } from "@/lib/time";
import { reimbursable } from "@/lib/workflow";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Approvals" };

export default async function DirectorHome() {
  const u = await requireRole("DIRECTOR");
  const s = await getSettings();
  const base = { claimant: { isDemo: u.isDemo }, claimantId: { not: u.id } };
  const [queue, history] = await Promise.all([
    prisma.claim.findMany({
      where: { ...base, status: "PENDING_DIRECTOR" },
      include: { claimant: { include: { branch: true } }, lines: { include: { category: true } } },
      orderBy: { financeVerifiedAt: "asc" },
    }),
    prisma.claim.findMany({
      where: { ...base, events: { some: { action: { in: ["DIRECTOR_APPROVE", "DIRECTOR_REJECT", "DIRECTOR_CLARIFY"] }, actorId: u.id } } },
      include: { claimant: true, lines: true, events: { where: { action: { startsWith: "DIRECTOR_" } }, orderBy: { at: "desc" }, take: 1 } },
      orderBy: { directorDecidedAt: "desc" },
      take: 50,
    }),
  ]);
  const total = queue.reduce((a, c) => a + reimbursable(c.lines, c.advanceSen), 0);
  const overdueMs = s.directorOverdueDays * 24 * 3600 * 1000;
  return (
    <AppShell user={u}>
      <PageTitle title="Claims pending your approval" sub={<>{queue.length} claim{queue.length === 1 ? "" : "s"} · <Money sen={total} /> · all verified by Finance</>} />
      {queue.length === 0 ? <Empty>Nothing waiting for approval.</Empty> : null}
      <ul className="space-y-2">
        {queue.map((c) => {
          const overdue = c.financeVerifiedAt && Date.now() - c.financeVerifiedAt.getTime() > overdueMs;
          const special = c.lines.some((l) => l.category.specialApproval && l.finStatus === "VERIFIED");
          return (
            <li key={c.id}>
              <Link href={`/director/claims/${c.id}`} className={`card flex items-center gap-3 p-4 hover:border-gray-400 ${overdue ? "border-amber-400" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.claimant.name}</span>
                    <span className="text-sm text-gray-500">{c.claimant.branch?.name}</span>
                    {overdue ? <span className="chip bg-amber-100 text-amber-800">waiting &gt; {s.directorOverdueDays} days</span> : null}
                    {special ? <span className="chip bg-violet-100 text-violet-800">special approval category</span> : null}
                  </div>
                  <div className="text-sm text-gray-500">{c.ref} · {monthLabel(c.claimYear, c.claimMonth)} · {c.lines.filter((l) => l.finStatus === "VERIFIED").length} verified expense(s) · verified {fmtDateTime(c.financeVerifiedAt)}</div>
                </div>
                <Money sen={reimbursable(c.lines, c.advanceSen)} className="text-lg font-bold" />
              </Link>
            </li>
          );
        })}
      </ul>
      <h2 className="mb-2 mt-8 font-bold">My recent decisions</h2>
      {history.length === 0 ? <Empty>No decisions yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50"><tr><th className="th">Claim</th><th className="th">Staff</th><th className="th">Decision</th><th className="th">When</th><th className="th">Now</th><th className="th text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((c) => (
                <tr key={c.id}>
                  <td className="td"><Link className="text-blue-700 underline" href={`/director/claims/${c.id}`}>{c.ref}</Link></td>
                  <td className="td">{c.claimant.name}</td>
                  <td className="td">{c.events[0]?.action.replace("DIRECTOR_", "")}</td>
                  <td className="td text-gray-500">{fmtDateTime(c.events[0]?.at)}</td>
                  <td className="td"><StatusBadge status={c.status} /></td>
                  <td className="td text-right"><Money sen={reimbursable(c.lines, c.advanceSen)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
