"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ClaimStatus, LineStatus } from "@prisma/client";
import type { Check } from "@/lib/claims";
import type { EinvoiceFieldMode } from "@/lib/settings";
import { deleteLineAction, discardAction, submitAction, updateMetaAction } from "@/app/actions/staff";
import { ExpenseForm } from "./expense-form";

export interface DocLite { id: string; filename: string; mime: string; enhanced: boolean }
export interface LineData {
  id: string; lineNo: number; expenseDate: string; categoryId: string; categoryName: string; branchId: string; branchName: string;
  supplier: string; description: string; businessPurpose: string; location: string; receiptNo: string; amount: string; amountSen: number;
  staffPaymentMethod: string; docIsReceipt: boolean; docIsEinvoice: boolean; supplierTin: string; supplierBrn: string; supplierSst: string;
  invoiceNo: string; invoiceDate: string; einvoiceUuid: string; einvoiceStatus: string; remarks: string; finStatus: LineStatus; finComment: string;
  documents: DocLite[];
}
export interface CategoryLite { id: string; name: string; requiresLocation: boolean; requiresPurpose: boolean; requiresReceipt: boolean; einvoiceApplicable: boolean; guidance: string }
export interface EditorData {
  claim: {
    id: string; ref: string; status: ClaimStatus; version: number; month: string; monthLabel: string; staffRemarks: string; financeRemarks: string;
    claimantName: string; forSomeoneElse: boolean; everSubmitted: boolean; parentRef: string | null;
  };
  lines: LineData[];
  unattached: DocLite[];
  categories: CategoryLite[];
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  today: string;
  settings: {
    einvoiceEffectiveDate: string;
    einvoiceFields: Record<string, EinvoiceFieldMode>;
    staffPaymentMethods: { value: string; label: string }[];
    maxUploadMb: number;
  };
  checks: Check[];
}

const rm = (sen: number) => `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ClaimEditor({ data }: { data: EditorData }) {
  const router = useRouter();
  const [editing, setEditing] = useState<LineData | "new" | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [remarks, setRemarks] = useState(data.claim.staffRemarks);
  const [confirming, setConfirming] = useState(false);
  const [submitKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  const { claim, lines, checks } = data;
  const total = useMemo(() => lines.reduce((a, l) => a + l.amountSen, 0), [lines]);
  const errors = checks.filter((c) => c.level === "error");
  const warnings = checks.filter((c) => c.level === "warning");
  const returned = claim.status === "RETURNED";

  function submit() {
    setMsg(null);
    start(async () => {
      if (remarks !== claim.staffRemarks) await updateMetaAction(claim.id, { staffRemarks: remarks });
      const r = await submitAction(claim.id, submitKey);
      if (!r.ok) {
        setConfirming(false);
        setMsg({ tone: "red", text: r.error });
        return;
      }
      const refs = (r.data as { refs: string[] }).refs;
      setMsg({ tone: "green", text: refs.length > 1 ? `Submitted as ${refs.join(", ")} (split by company).` : `Submitted ${refs[0]} to Finance.` });
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Link href="/staff" className="text-gray-500 hover:text-gray-900">← My claims</Link>
      </div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{claim.ref}</h1>
          <div className="text-sm text-gray-500">
            {claim.monthLabel} · {returned ? "Returned for correction" : "Draft"}{claim.version > 1 ? ` · version ${claim.version}` : ""}
            {claim.forSomeoneElse ? ` · for ${claim.claimantName}` : ""}
          </div>
          {claim.parentRef ? <div className="text-xs text-gray-500">Carried forward from {claim.parentRef}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase text-gray-500">Total</div>
          <div className="text-2xl font-bold num">{rm(total)}</div>
        </div>
      </div>

      {returned && claim.financeRemarks ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Finance comments</div>
          <div className="whitespace-pre-line">{claim.financeRemarks}</div>
          <div className="mt-1 text-xs">Make the corrections below, then resubmit. Your previous submission is kept on record.</div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.id} className={`card p-4 ${l.finStatus === "QUERIED" ? "border-amber-400" : ""} ${l.finStatus === "REJECTED" ? "border-red-300 opacity-80" : ""}`}>
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100 text-sm font-bold">{l.lineNo}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-semibold">{l.supplier}</div>
                  <div className="font-bold num">{rm(l.amountSen)}</div>
                </div>
                <div className="text-sm text-gray-600">{l.description}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {l.expenseDate.split("-").reverse().join("/")} · {l.categoryName} · {l.branchName}
                  {l.receiptNo ? ` · No. ${l.receiptNo}` : ""}
                </div>
                {l.finStatus === "QUERIED" ? <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><b>Finance query:</b> {l.finComment}</div> : null}
                {l.finStatus === "REJECTED" ? <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"><b>Rejected by Finance:</b> {l.finComment}</div> : null}
                {l.finStatus === "VERIFIED" ? <div className="mt-2 text-xs font-semibold text-emerald-700">✓ Verified by Finance</div> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {l.documents.map((d) => (
                    <a key={d.id} href={`/api/documents/${d.id}${d.enhanced ? "?enhanced=1" : ""}`} target="_blank" className="block h-14 w-12 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                      {d.mime === "application/pdf" ? (
                        <span className="grid h-full place-items-center text-[10px] font-bold text-red-700">PDF</span>
                      ) : (
                        <img src={`/api/documents/${d.id}${d.enhanced ? "?enhanced=1" : ""}`} alt={d.filename} className="h-full w-full object-cover" />
                      )}
                    </a>
                  ))}
                  {l.documents.length === 0 ? <span className="text-xs font-semibold text-red-600">No receipt attached</span> : null}
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-ghost btn-sm" onClick={() => setEditing(l)}>Edit</button>
              <button
                className="btn-ghost btn-sm text-red-700"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Remove expense ${l.lineNo} (${l.supplier})?`)) return;
                  start(async () => {
                    const r = await deleteLineAction(claim.id, l.id);
                    if (!r.ok) setMsg({ tone: "red", text: r.error });
                    router.refresh();
                  });
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button onClick={() => setEditing("new")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-white py-5 text-base font-semibold text-gray-700 hover:border-gray-500">
        <span className="text-2xl leading-none">+</span> Add expense
      </button>

      {lines.length ? (
        <div className="card mt-5 space-y-4 p-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Review &amp; submit</div>
            <a href={`/api/claims/${claim.id}/supporting`} target="_blank" className="text-sm font-semibold text-blue-700 underline">Preview combined PDF</a>
          </div>
          {errors.length ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="font-semibold">Please fix before submitting:</div>
              <ul className="ml-4 list-disc">{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            </div>
          ) : null}
          {warnings.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">Please check (you can still submit; Finance will review):</div>
              <ul className="ml-4 list-disc">{warnings.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="remarks">Remarks for Finance (optional)</label>
            <textarea id="remarks" className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} />
          </div>
          {msg ? <div className={`rounded-lg px-3 py-2 text-sm ${msg.tone === "red" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"} whitespace-pre-line`}>{msg.text}</div> : null}
          {!confirming ? (
            <button className="btn-brand w-full py-4 text-base" disabled={pending || errors.length > 0} onClick={() => setConfirming(true)}>
              {returned ? "Resubmit to Finance" : "Submit to Finance"} · {rm(total)}
            </button>
          ) : (
            <div className="rounded-xl border border-gray-300 p-3">
              <div className="text-sm">
                I confirm these {lines.length} expense{lines.length === 1 ? " was" : "s were"} incurred for company business and the supporting documents are genuine.
                After submission the claim cannot be edited unless Finance returns it.
              </div>
              <div className="mt-3 flex gap-2">
                <button className="btn-brand flex-1 py-3" disabled={pending} onClick={submit}>{pending ? "Submitting…" : "Confirm & submit"}</button>
                <button className="btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>Back</button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {!claim.everSubmitted ? (
        <div className="mt-6 text-center">
          <button
            className="text-sm text-gray-500 underline"
            onClick={() => {
              if (confirm("Discard this draft? This cannot be undone.")) start(async () => { await discardAction(claim.id); });
            }}
          >
            Discard draft
          </button>
        </div>
      ) : null}

      {editing ? (
        <ExpenseForm
          data={data}
          line={editing === "new" ? null : editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
