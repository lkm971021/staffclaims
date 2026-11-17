import Link from "next/link";
import type { ClaimStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/rbac";
import { Money, StatusBadge, Chip } from "./ui";
import { STATUS_LABEL, reimbursable, submittedTotal } from "@/lib/workflow";
import { fmtDate, fmtDateTime, monthLabel } from "@/lib/time";
import { rm } from "@/lib/money";

const STEPS: { key: string; label: string; done: (s: ClaimStatus, own: boolean) => boolean }[] = [
  { key: "sub", label: "Submitted", done: (s) => s !== "DRAFT" },
  { key: "fin", label: "Finance verified", done: (s) => ["PENDING_DIRECTOR", "APPROVED_FOR_PAYMENT", "PAID"].includes(s) },
  { key: "dir", label: "Director approved", done: (s) => ["APPROVED_FOR_PAYMENT", "PAID"].includes(s) },
  { key: "paid", label: "Paid", done: (s) => s === "PAID" },
];

export async function ClaimView({ claimId, viewer, backHref }: { claimId: string; viewer: SessionUser; backHref: string }) {
  const c = await prisma.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: {
      claimant: { include: { branch: true } },
      submittedBy: true,
      lines: { orderBy: { lineNo: "asc" }, include: { category: true, branch: true, documents: { where: { kind: "ORIGINAL", removedAt: null, supersededAt: null } } } },
      events: { orderBy: { at: "asc" } },
      paymentItem: { include: { batch: true } },
      parentClaim: { select: { id: true, ref: true } },
      supplementaries: { select: { id: true, ref: true, status: true } },
    },
  });
  const verifiedAny = c.lines.some((l) => l.finStatus !== "PENDING");
  const pb = c.paymentItem?.batch.status === "POSTED" ? c.paymentItem.batch : null;
  const isClaimantSide = viewer.id === c.claimantId || viewer.id === c.submittedById;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-900">← Back</Link>
      <div className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{c.ref}</h1>
          <div className="text-sm text-gray-500">{c.claimant.name} · {monthLabel(c.claimYear, c.claimMonth)} · v{c.version}</div>
          <div className="mt-1"><StatusBadge status={c.status} long /></div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase text-gray-500">{verifiedAny ? "Verified amount" : "Total claimed"}</div>
          <div className="text-2xl font-bold num">{rm(verifiedAny ? reimbursable(c.lines, c.advanceSen) : submittedTotal(c.lines))}</div>
          {verifiedAny ? <div className="text-xs text-gray-500">Claimed {rm(submittedTotal(c.lines))}</div> : null}
        </div>
      </div>

      {c.status !== "REJECTED" ? (
        <ol className="mb-4 grid grid-cols-4 gap-1 text-center text-[11px] font-semibold">
          {STEPS.filter((s) => !(s.key === "dir" && c.isDirectorOwnClaim)).map((s) => {
            const done = s.done(c.status, c.isDirectorOwnClaim);
            return (
              <li key={s.key} className={`rounded-lg px-1 py-2 ${done ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500"}`}>{s.label}</li>
            );
          })}
        </ol>
      ) : null}

      {c.status === "REJECTED" ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <b>Rejected.</b> {c.directorRemarks || c.financeRemarks}
        </div>
      ) : null}
      {c.status === "CLARIFICATION" && isClaimantSide ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The Director has asked Finance for clarification. Finance may contact you.</div>
      ) : null}
      {c.supplementaries.length ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Some expenses were moved to {c.supplementaries.map((s) => <Link key={s.id} className="font-semibold underline" href={`/staff/claims/${s.id}`}>{s.ref}</Link>)} for correction.
        </div>
      ) : null}
      {c.parentClaim ? <div className="mb-4 text-sm text-gray-500">Carried forward from {c.parentClaim.ref}.</div> : null}

      {pb ? (
        <div className="card mb-4 p-4 text-sm">
          <div className="font-semibold text-emerald-700">Paid {rm(c.paymentItem!.amountSen)}</div>
          <div className="text-gray-600">{fmtDate(pb.paymentDate, true)} · {pb.method} · Ref {c.paymentItem!.paymentRef ?? pb.bankRef}</div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {c.lines.map((l) => (
          <li key={l.id} className="card p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100 text-sm font-bold">{l.lineNo}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-semibold">{l.supplier}</div>
                  <Money sen={l.amountSen} className="font-bold" />
                </div>
                <div className="text-sm text-gray-600">{l.description}</div>
                <div className="mt-1 text-xs text-gray-500">{fmtDate(l.expenseDate, true)} · {l.category.name} · {l.branch.name}{l.receiptNo ? ` · No. ${l.receiptNo}` : ""}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {l.finStatus === "VERIFIED" ? <Chip tone="green">Verified {l.verifiedAmountSen !== null && l.verifiedAmountSen !== l.amountSen ? rm(l.verifiedAmountSen) : ""}</Chip> : null}
                  {l.finStatus === "QUERIED" ? <Chip tone="amber">Queried</Chip> : null}
                  {l.finStatus === "REJECTED" ? <Chip tone="red">Rejected</Chip> : null}
                  {l.documents.map((d) => (
                    <a key={d.id} href={`/api/documents/${d.id}`} target="_blank" className="text-xs font-semibold text-blue-700 underline">{d.filename}</a>
                  ))}
                </div>
                {l.finComment ? <div className="mt-1 text-xs text-gray-600">Finance: {l.finComment}</div> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <a className="btn-ghost btn-sm" href={`/api/claims/${c.id}/summary`} target="_blank">Claim summary PDF</a>
        <a className="btn-ghost btn-sm" href={`/api/claims/${c.id}/supporting`} target="_blank">Supporting documents PDF</a>
      </div>

      <h2 className="mb-2 mt-6 font-bold">History</h2>
      <ol className="card divide-y divide-gray-100 text-sm">
        {c.events.map((e) => (
          <li key={e.id} className="flex flex-wrap gap-x-3 px-4 py-2">
            <span className="w-36 shrink-0 text-gray-500">{fmtDateTime(e.at)}</span>
            <span className="font-medium">{STATUS_LABEL[e.toStatus]}</span>
            <span className="text-gray-500">by {e.actorName}</span>
            {e.remarks ? <span className="w-full text-gray-600">“{e.remarks}”</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
