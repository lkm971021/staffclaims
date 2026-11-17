import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole, canViewClaim } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { Money, StatusBadge, Chip } from "@/components/ui";
import { DocViewer } from "@/components/doc-viewer";
import { fmtDate, fmtDateTime, monthLabel } from "@/lib/time";
import { reimbursable, submittedTotal } from "@/lib/workflow";
import { DirectorActions } from "./director-actions";

export const metadata = { title: "Review claim" };

export default async function DirectorClaim({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ line?: string }> }) {
  const u = await requireRole("DIRECTOR");
  const { id } = await params;
  const { line: lineParam } = await searchParams;
  const c = await prisma.claim.findUnique({
    where: { id },
    include: {
      claimant: { include: { branch: true } },
      company: true,
      lines: {
        orderBy: { lineNo: "asc" },
        include: { category: true, branch: true, adjustments: true, duplicateFlags: true, documents: { where: { kind: { in: ["ORIGINAL", "ADDITIONAL", "ENHANCED"] }, removedAt: null, supersededAt: null } } },
      },
      events: { orderBy: { at: "asc" } },
    },
  });
  if (!c || !(await canViewClaim(u, c)) || c.claimantId === u.id) notFound();
  const sel = c.lines.find((l) => l.id === lineParam) ?? c.lines.find((l) => l.finStatus === "VERIFIED") ?? c.lines[0];
  const enhancedOf = new Map(sel.documents.filter((d) => d.kind === "ENHANCED").map((d) => [d.derivedFromId, d.id]));
  const docs = sel.documents.filter((d) => d.kind !== "ENHANCED").map((d) => ({ id: d.id, label: d.filename, mime: d.mime, enhancedId: enhancedOf.get(d.id) ?? null }));
  const fv = [...c.events].reverse().find((e) => e.action === "FINANCE_VERIFY");
  return (
    <AppShell user={u} wide>
      <Link href="/director" className="text-sm text-gray-500 hover:text-gray-900">← Approvals</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{c.claimant.name}</h1>
          <div className="text-sm text-gray-600">{c.ref} · {c.claimant.branch?.name} · {c.claimant.position} · {monthLabel(c.claimYear, c.claimMonth)} · {c.company.name}</div>
          <div className="mt-1"><StatusBadge status={c.status} long /></div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase text-gray-500">Amount for approval</div>
          <div className="text-3xl font-bold num">{(() => { const v = reimbursable(c.lines, c.advanceSen); return <Money sen={v} />; })()}</div>
          <div className="text-xs text-gray-500">Claimed <Money sen={submittedTotal(c.lines)} />{c.advanceSen ? <> · advance <Money sen={c.advanceSen} /> deducted</> : null}</div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50"><tr><th className="th">#</th><th className="th">Date</th><th className="th">Category</th><th className="th">Supplier / description</th><th className="th">Finance</th><th className="th text-right">Claimed</th><th className="th text-right">Verified</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {c.lines.map((l) => (
                  <tr key={l.id} className={l.id === sel.id ? "bg-blue-50" : ""}>
                    <td className="td"><Link className="font-semibold text-blue-700 underline" href={`/director/claims/${c.id}?line=${l.id}`}>{l.lineNo}</Link></td>
                    <td className="td">{fmtDate(l.expenseDate, true)}</td>
                    <td className="td text-xs">{l.category.name}{l.category.specialApproval ? <Chip tone="violet">special</Chip> : null}</td>
                    <td className="td whitespace-normal"><div className="font-medium">{l.supplier}</div><div className="text-xs text-gray-500">{l.description}{l.businessPurpose ? ` — ${l.businessPurpose}` : ""}</div>
                      {l.finComment ? <div className="text-xs text-gray-600">Finance: {l.finComment}</div> : null}
                      {l.duplicateFlags.length ? <div className="text-xs text-red-700">Duplicate check: {l.duplicateFlags.map((f) => `${f.decision.replace("_", " ").toLowerCase()} (${f.explanation ?? ""})`).join("; ")}</div> : null}</td>
                    <td className="td"><Chip tone={l.finStatus === "VERIFIED" ? "green" : l.finStatus === "REJECTED" ? "red" : "amber"}>{l.finStatus}</Chip></td>
                    <td className="td text-right"><Money sen={l.amountSen} /></td>
                    <td className="td text-right font-semibold">{l.finStatus === "VERIFIED" ? <Money sen={l.verifiedAmountSen ?? l.amountSen} /> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card space-y-1 p-4 text-sm">
            <div><b>Finance verification:</b> {fv ? `${fv.actorName}, ${fmtDateTime(fv.at)}` : "-"}{c.financeRemarks ? ` — “${c.financeRemarks}”` : ""}</div>
            {c.staffRemarks ? <div><b>Claimant remarks:</b> {c.staffRemarks}</div> : null}
            <div className="flex flex-wrap gap-2 pt-2">
              <a className="btn-ghost btn-sm" target="_blank" href={`/api/claims/${c.id}/summary`}>Claim summary PDF</a>
              <a className="btn-ghost btn-sm" target="_blank" href={`/api/claims/${c.id}/supporting`}>All supporting documents (PDF)</a>
            </div>
          </div>
          {c.status === "PENDING_DIRECTOR" ? <DirectorActions claimId={c.id} /> : null}
          <div className="card p-4">
            <div className="mb-2 font-semibold">History</div>
            <ol className="space-y-1 text-sm">{c.events.map((e) => <li key={e.id}><span className="text-gray-500">{fmtDateTime(e.at)}</span> · {e.action} · {e.actorName}{e.remarks ? ` — “${e.remarks}”` : ""}</li>)}</ol>
          </div>
        </div>
        <div className="xl:sticky xl:top-20 xl:self-start">
          <DocViewer docs={docs} title={`Expense #${sel.lineNo} · ${sel.supplier}`} height="78vh" />
        </div>
      </div>
    </AppShell>
  );
}
