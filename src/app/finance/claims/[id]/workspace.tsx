"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ClaimStatus, LineStatus } from "@prisma/client";
import {
  advanceAction, duplicateAction, hardcopyAction, lineVerifyAction, rejectClaimAction, retryArchiveAction, returnClaimAction, verifyClaimAction,
} from "@/app/actions/finance";
import { DocViewer, type ViewDoc } from "@/components/doc-viewer";

type Doc = { id: string; filename: string; mime: string; enhancedId: string | null; superseded: boolean; version: number; uploadedAt: string; sizeKb: number; drive: string };
type Dup = {
  id: string; rule: string; detail: string; decision: "OPEN" | "NOT_DUPLICATE" | "DUPLICATE"; explanation: string; decidedBy: string; decidedAt: string;
  match: { claimId: string; ref: string; status: string; claimant: string; lineNo: number; supplier: string; date: string; amountSen: number; receiptNo: string; docs: { id: string; filename: string; mime: string }[] };
};
type Ocr = {
  supplier: string | null; receiptNo: string | null; docDate: string | null; totalSen: number | null; taxSen: number | null; subtotalSen: number | null;
  supplierTin: string | null; supplierBrn: string | null; supplierSst: string | null; legible: boolean | null; confidence: number | null; engine: string;
  documentType: string | null; notes: string | null;
};
export interface WsLine {
  id: string; lineNo: number; expenseDate: string; category: string; glCode: string; branch: string; supplier: string; description: string; businessPurpose: string;
  location: string; receiptNo: string; amountSen: number; staffPaymentMethod: string; docIsReceipt: boolean; docIsEinvoice: boolean;
  einvoice: Record<string, string | null>; einvoiceApplies: boolean; remarks: string; finStatus: LineStatus; verifiedAmountSen: number | null; finComment: string;
  hardcopy: string | null; warnings: { code: string; message: string }[]; checklist: string[]; specialApproval: boolean;
  adjustments: { at: string; by: string; from: string | null; to: string | null; reason: string }[]; ocr: Ocr | null; docs: Doc[];
  additional: { id: string; filename: string; mime: string }[]; duplicates: Dup[];
}
export interface WsData {
  claim: {
    id: string; ref: string; status: ClaimStatus; statusLabel: string; version: number; monthLabel: string;
    claimant: { name: string; employeeNo: string; branch: string; position: string; department: string; nric: string; tin: string };
    company: string; submittedBy: string | null; submittedAt: string; late: boolean; deadline: string; advanceSen: number; staffRemarks: string;
    financeRemarks: string; directorRemarks: string; isDirectorOwnClaim: boolean; isOwn: boolean; archiveStatus: string; driveFolderUrl: string | null;
    driveMode: "live" | "mock"; parent: { id: string; ref: string } | null; supplementaries: { id: string; ref: string; status: ClaimStatus }[];
    payment: { ref: string; status: string; date: string; method: string; bankRef: string; amountSen: number } | null;
  };
  lines: WsLine[];
  claimDocs: { id: string; kind: string; filename: string; mime: string; superseded: boolean; drive: string }[];
  events: { at: string; who: string; role: string; action: string; to: string; remarks: string }[];
  versions: { version: number; totalSen: number; at: string; reason: string }[];
  hardcopyRequired: boolean;
}

const rm = (sen: number | null | undefined) => (sen === null || sen === undefined ? "-" : `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const PAYMENT: Record<string, string> = { CASH: "Cash", PERSONAL_CARD: "Personal card", E_WALLET: "e-Wallet", ONLINE_TRANSFER: "Online transfer", OTHER: "Other" };

export function Workspace({ data }: { data: WsData }) {
  const { claim, lines } = data;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(lines[0]?.id ?? "");
  const [compare, setCompare] = useState<ViewDoc[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const atFinance = claim.status === "PENDING_FINANCE" || claim.status === "CLARIFICATION";
  const canAct = atFinance && !claim.isOwn;
  const line = lines.find((l) => l.id === sel) ?? lines[0];

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) setMsg({ tone: "red", text: r.error ?? "Failed" });
      else {
        if (ok) setMsg({ tone: "green", text: ok });
        router.refresh();
      }
    });

  const submitted = lines.reduce((a, l) => a + l.amountSen, 0);
  const verified = lines.filter((l) => l.finStatus === "VERIFIED").reduce((a, l) => a + (l.verifiedAmountSen ?? l.amountSen), 0);
  const counts = { VERIFIED: 0, QUERIED: 0, REJECTED: 0, PENDING: 0 } as Record<LineStatus, number>;
  lines.forEach((l) => counts[l.finStatus]++);
  const openDup = lines.reduce((a, l) => a + l.duplicates.filter((d) => d.decision === "OPEN").length, 0);

  const viewDocs: ViewDoc[] = line
    ? [
        ...line.docs.map((d) => ({ id: d.id, label: `${d.superseded ? "[superseded v" + d.version + "] " : ""}${d.filename}`, mime: d.mime, enhancedId: d.enhancedId })),
        ...line.additional.map((d) => ({ id: d.id, label: `[additional] ${d.filename}`, mime: d.mime, enhancedId: null })),
      ]
    : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/finance/claims" className="text-gray-500 hover:text-gray-900">← Register</Link>
      </div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{claim.ref} <span className="text-sm font-normal text-gray-500">v{claim.version}</span></h1>
          <div className="text-sm text-gray-600">
            {claim.claimant.employeeNo} · <b>{claim.claimant.name}</b> · {claim.claimant.branch} · {claim.claimant.position} · {claim.company}
          </div>
          <div className="text-xs text-gray-500">
            {claim.monthLabel} · submitted {claim.submittedAt}{claim.submittedBy ? ` by ${claim.submittedBy} (team leader)` : ""}
            {claim.late ? <span className="ml-1 font-semibold text-red-700">· LATE (deadline {claim.deadline})</span> : null}
            {claim.isDirectorOwnClaim ? <span className="ml-1 font-semibold text-violet-700">· Director&apos;s own claim — Finance verification is final</span> : null}
          </div>
          {claim.parent ? <div className="text-xs">Supplementary to <Link className="underline" href={`/finance/claims/${claim.parent.id}`}>{claim.parent.ref}</Link></div> : null}
          {claim.supplementaries.length ? <div className="text-xs">Queried lines moved to {claim.supplementaries.map((s) => <Link key={s.id} className="mr-1 underline" href={`/finance/claims/${s.id}`}>{s.ref}</Link>)}</div> : null}
        </div>
        <div className="text-right">
          <div className="chip bg-gray-900 text-white">{claim.statusLabel}</div>
          <div className="mt-1 text-sm">Claimed <b className="num">{rm(submitted)}</b></div>
          <div className="text-sm">Verified <b className="num text-emerald-700">{rm(verified)}</b>{claim.advanceSen ? <> − advance {rm(claim.advanceSen)} = <b>{rm(verified - claim.advanceSen)}</b></> : null}</div>
        </div>
      </div>

      {claim.isOwn ? <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">This is your own claim. Another Finance user must verify it.</div> : null}
      {claim.directorRemarks && claim.status === "CLARIFICATION" ? (
        <div className="mb-3 rounded-xl border border-violet-300 bg-violet-50 px-4 py-2 text-sm text-violet-900"><b>Director&apos;s query:</b> {claim.directorRemarks}</div>
      ) : null}
      {claim.staffRemarks ? <div className="mb-3 rounded-xl bg-gray-100 px-4 py-2 text-sm"><b>Claimant remarks:</b> {claim.staffRemarks}</div> : null}
      {msg ? <div className={`mb-3 whitespace-pre-line rounded-xl px-4 py-2 text-sm ${msg.tone === "red" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div> : null}

      {/* line tabs */}
      <div className="mb-3 flex gap-1 overflow-x-auto">
        {lines.map((l) => (
          <button key={l.id} onClick={() => { setSel(l.id); setCompare(null); }} className={`shrink-0 rounded-lg border px-3 py-1.5 text-left text-xs ${l.id === line?.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white"}`}>
            <div className="font-semibold">#{l.lineNo} {l.supplier.slice(0, 18)}</div>
            <div className="flex items-center gap-1">
              {rm(l.amountSen)}
              <span className={`ml-1 rounded px-1 text-[10px] font-bold ${l.finStatus === "VERIFIED" ? "bg-emerald-500 text-white" : l.finStatus === "QUERIED" ? "bg-amber-400 text-white" : l.finStatus === "REJECTED" ? "bg-red-500 text-white" : "bg-gray-200 text-gray-700"}`}>{l.finStatus}</span>
              {l.duplicates.some((d) => d.decision === "OPEN") ? <span className="rounded bg-red-600 px-1 text-[10px] font-bold text-white">DUP</span> : null}
              {l.warnings.length ? <span className="rounded bg-amber-200 px-1 text-[10px] font-bold text-amber-900">{l.warnings.length}!</span> : null}
            </div>
          </button>
        ))}
      </div>

      {line ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {/* LEFT: documents */}
          <div className="xl:sticky xl:top-20 xl:self-start">
            {compare ? (
              <div className="grid grid-cols-2 gap-2">
                <DocViewer docs={viewDocs} title={`This claim · #${line.lineNo}`} height="70vh" />
                <DocViewer docs={compare} title="Earlier / matching claim" height="70vh" onClose={() => setCompare(null)} />
              </div>
            ) : (
              <DocViewer docs={viewDocs} title={`Expense #${line.lineNo} supporting documents`} height="75vh" />
            )}
          </div>

          {/* RIGHT: claim information + verification */}
          <div className="space-y-4">
            <LineDetails line={line} />
            {line.ocr ? <OcrCompare line={line} /> : <div className="card p-3 text-xs text-gray-500">No OCR result for this line (OCR off, failed, or PDF not processed). Verify manually.</div>}
            {line.warnings.length ? (
              <div className="card border-amber-300 p-4">
                <div className="mb-1 font-semibold text-amber-900">System checks at submission</div>
                <ul className="ml-4 list-disc text-sm text-amber-900">{line.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
              </div>
            ) : null}
            {line.duplicates.length ? (
              <div className="card border-red-300 p-4">
                <div className="mb-2 font-semibold text-red-800">Possible duplicates — Finance decision required</div>
                <div className="space-y-3">
                  {line.duplicates.map((d) => (
                    <DupCard key={d.id} d={d} canAct={!claim.isOwn} onCompare={() => setCompare(d.match.docs.map((x) => ({ id: x.id, label: `${d.match.ref} #${d.match.lineNo} · ${x.filename}`, mime: x.mime, enhancedId: null })))}
                      onDecide={(decision, explanation) => act(() => duplicateAction(claim.id, d.id, decision, explanation), "Decision recorded.")} pending={pending} />
                  ))}
                </div>
              </div>
            ) : null}
            <VerifyPanel key={line.id + line.finStatus} line={line} canAct={canAct} pending={pending} hardcopyRequired={data.hardcopyRequired}
              onVerify={(input) => act(() => lineVerifyAction(claim.id, line.id, input))}
              onHardcopy={(v) => act(() => hardcopyAction(claim.id, line.id, v))} isFinanceStage={!claim.isOwn} />
          </div>
        </div>
      ) : null}

      {/* CLAIM-LEVEL */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="card space-y-3 p-4 lg:col-span-2">
          <div className="font-semibold">Complete Finance verification</div>
          <div className="text-sm text-gray-600">
            Lines: {counts.VERIFIED} verified · {counts.QUERIED} queried · {counts.REJECTED} rejected · {counts.PENDING} not yet checked{openDup ? <> · <b className="text-red-700">{openDup} duplicate flag(s) open</b></> : null}
          </div>
          {canAct ? <ClaimActions data={data} counts={counts} pending={pending} act={act} /> : <div className="text-sm text-gray-500">{claim.isOwn ? "You cannot process your own claim." : "This claim is not at the Finance verification stage."}</div>}
        </div>
        <div className="card space-y-2 p-4 text-sm">
          <div className="font-semibold">Documents &amp; archive</div>
          <div className="flex flex-wrap gap-2">
            <a className="btn-ghost btn-sm" target="_blank" href={`/api/claims/${claim.id}/summary`}>Claim summary PDF</a>
            <a className="btn-ghost btn-sm" target="_blank" href={`/api/claims/${claim.id}/supporting`}>Supporting PDF</a>
            <a className="btn-ghost btn-sm" href={`/api/claims/${claim.id}/zip`}>Download ZIP</a>
          </div>
          <div>
            Google Drive: <b>{claim.archiveStatus}</b> {claim.driveMode === "mock" ? <span className="chip bg-amber-100 text-amber-800">MOCK – local only</span> : null}
            {claim.driveFolderUrl && claim.driveMode === "live" ? <> · <a className="underline" target="_blank" href={claim.driveFolderUrl}>Open folder</a></> : null}
          </div>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => act(() => retryArchiveAction(claim.id), "Archive and Sheet sync queued.")}>Retry Drive / Sheet sync</button>
          {data.claimDocs.length ? (
            <ul className="max-h-40 space-y-1 overflow-auto text-xs">
              {data.claimDocs.map((d) => (
                <li key={d.id}><a className="underline" target="_blank" href={`/api/documents/${d.id}`}>{d.filename}</a> <span className="text-gray-400">{d.kind} · {d.drive}</span></li>
              ))}
            </ul>
          ) : null}
          {claim.payment ? <div className="rounded-lg bg-emerald-50 p-2">Payment {claim.payment.ref} ({claim.payment.status}) {claim.payment.date} · {claim.payment.method} · {claim.payment.bankRef} · {rm(claim.payment.amountSen)}</div> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-2 font-semibold">Approval &amp; audit history</div>
          <ol className="divide-y divide-gray-100 text-sm">
            {data.events.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="w-36 shrink-0 text-gray-500">{e.at}</span>
                <span className="font-medium">{e.action}</span><span>→ {e.to}</span><span className="text-gray-500">{e.who} ({e.role})</span>
                {e.remarks ? <span className="w-full text-gray-600">“{e.remarks}”</span> : null}
              </li>
            ))}
          </ol>
        </div>
        <div className="card p-4 text-sm">
          <div className="mb-2 font-semibold">Submitted versions</div>
          <ul className="space-y-1">{data.versions.map((v) => <li key={v.version}>v{v.version} · {rm(v.totalSen)} · {v.at}<div className="text-xs text-gray-500">{v.reason}</div></li>)}</ul>
          <div className="mt-2 text-xs text-gray-500">Previous versions&apos; documents are kept and marked “superseded”.</div>
        </div>
      </div>
    </div>
  );
}

function LineDetails({ line }: { line: WsLine }) {
  const row = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-3 gap-2 py-1"><dt className="text-gray-500">{k}</dt><dd className="col-span-2 font-medium">{v || <span className="text-gray-300">—</span>}</dd></div>
  );
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Expense #{line.lineNo}</div><div className="text-lg font-bold num">{rm(line.amountSen)}</div></div>
      <dl className="divide-y divide-gray-100 text-sm">
        {row("Expense date", line.expenseDate.split("-").reverse().join("/"))}
        {row("Category", <>{line.category}{line.glCode ? <span className="ml-1 text-xs text-gray-500">GL {line.glCode}</span> : null}{line.specialApproval ? <span className="chip ml-1 bg-violet-50 text-violet-700">special approval</span> : null}</>)}
        {row("Branch charged", line.branch)}
        {row("Supplier", line.supplier)}
        {row("Description", line.description)}
        {row("Business purpose", line.businessPurpose)}
        {line.location ? row("Location / route", line.location) : null}
        {row("Receipt no.", line.receiptNo)}
        {row("Paid by staff via", PAYMENT[line.staffPaymentMethod] ?? line.staffPaymentMethod)}
        {row("Document type", [line.docIsReceipt && "Receipt", line.docIsEinvoice && "e-Invoice"].filter(Boolean).join(", "))}
        {line.remarks ? row("Remarks", line.remarks) : null}
      </dl>
      {line.einvoiceApplies ? (
        <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs">
          <div className="mb-1 font-semibold">e-Invoice information</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries({ "Supplier TIN": line.einvoice.supplierTin, "Supplier BRN": line.einvoice.supplierBrn, "SST No.": line.einvoice.supplierSst, "Invoice No.": line.einvoice.invoiceNo, "Invoice date": line.einvoice.invoiceDate, UUID: line.einvoice.einvoiceUuid, "Validation status": line.einvoice.einvoiceStatus }).map(([k, v]) => (
              <div key={k}><span className="text-gray-500">{k}: </span>{v || <span className="text-gray-400">not provided</span>}</div>
            ))}
          </div>
          <div className="mt-1 text-gray-500">Missing e-Invoice details are for Finance review only — they do not by themselves make a document invalid.</div>
        </div>
      ) : null}
    </div>
  );
}

function OcrCompare({ line }: { line: WsLine }) {
  const o = line.ocr!;
  const rows: [string, string, string | null, boolean | null][] = [
    ["Total", rm(line.amountSen), o.totalSen !== null ? rm(o.totalSen) : null, o.totalSen === null ? null : Math.abs(o.totalSen - line.amountSen) <= 1],
    ["Date", line.expenseDate, o.docDate, o.docDate === null ? null : o.docDate === line.expenseDate],
    ["Receipt no.", line.receiptNo, o.receiptNo, o.receiptNo === null ? null : o.receiptNo.replace(/\W/g, "").toUpperCase() === line.receiptNo.replace(/\W/g, "").toUpperCase()],
    ["Supplier", line.supplier, o.supplier, o.supplier === null ? null : o.supplier.toUpperCase().includes(line.supplier.toUpperCase().slice(0, 6))],
    ["Tax (SST)", "", o.taxSen !== null ? rm(o.taxSen) : null, null],
    ["Supplier TIN / BRN", [line.einvoice.supplierTin, line.einvoice.supplierBrn].filter(Boolean).join(" / "), [o.supplierTin, o.supplierBrn].filter(Boolean).join(" / ") || null, null],
  ];
  return (
    <div className="card p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="font-semibold">Staff entry vs. OCR reading</div>
        <div className="text-xs text-gray-500">{o.engine} · confidence {o.confidence !== null ? Math.round(o.confidence * 100) + "%" : "-"}</div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500"><th className="py-1 text-left">Field</th><th className="text-left">Staff entered</th><th className="text-left">OCR read</th><th /></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(([k, a, b, ok]) => (
            <tr key={k}><td className="py-1 text-gray-500">{k}</td><td>{a || "—"}</td><td>{b ?? <span className="text-gray-400">—</span>}</td>
              <td className="text-right">{ok === null ? "" : ok ? <span className="text-emerald-600">✓</span> : <span className="font-bold text-red-600">✗</span>}</td></tr>
          ))}
        </tbody>
      </table>
      {o.documentType ? <div className="mt-1 text-xs text-gray-500">Detected document type: {o.documentType.replace(/_/g, " ")}{o.legible === false ? " · may be illegible" : ""}</div> : null}
      {o.notes ? <div className="mt-1 text-xs text-gray-500">OCR note: {o.notes}</div> : null}
      <div className="mt-1 text-xs text-gray-400">OCR is a suggestion only. Finance verification is based on the document itself.</div>
    </div>
  );
}

function DupCard({ d, canAct, onCompare, onDecide, pending }: { d: Dup; canAct: boolean; onCompare: () => void; onDecide: (x: "NOT_DUPLICATE" | "DUPLICATE", e: string) => void; pending: boolean }) {
  const [exp, setExp] = useState(d.explanation);
  return (
    <div className="rounded-xl border border-gray-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><b>{d.detail}</b></div>
        <span className={`chip ${d.decision === "OPEN" ? "bg-red-100 text-red-800" : d.decision === "DUPLICATE" ? "bg-gray-900 text-white" : "bg-emerald-100 text-emerald-800"}`}>{d.decision.replace("_", " ")}</span>
      </div>
      <div className="mt-1 text-gray-600">
        Matches <Link className="font-semibold underline" href={`/finance/claims/${d.match.claimId}`} target="_blank">{d.match.ref}</Link> #{d.match.lineNo} ({d.match.status}) · {d.match.claimant} · {d.match.supplier} · {d.match.date} · {rm(d.match.amountSen)}{d.match.receiptNo ? ` · No. ${d.match.receiptNo}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-ghost btn-sm" onClick={onCompare} disabled={!d.match.docs.length}>Compare documents side by side</button>
      </div>
      {d.decision !== "OPEN" ? <div className="mt-2 text-xs text-gray-500">Decided by {d.decidedBy} on {d.decidedAt}: “{d.explanation}”</div> : null}
      {canAct ? (
        <div className="mt-2 space-y-2">
          <input className="input !py-2 !text-sm" placeholder="Explanation (required)" value={exp} onChange={(e) => setExp(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-success btn-sm" disabled={pending} onClick={() => onDecide("NOT_DUPLICATE", exp)}>Not a duplicate (override)</button>
            <button className="btn-danger btn-sm" disabled={pending} onClick={() => onDecide("DUPLICATE", exp)}>Confirm duplicate</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VerifyPanel({ line, canAct, pending, onVerify, onHardcopy, hardcopyRequired, isFinanceStage }: {
  line: WsLine; canAct: boolean; pending: boolean; hardcopyRequired: boolean; isFinanceStage: boolean;
  onVerify: (i: { status: LineStatus; verifiedAmount?: string; comment?: string; adjustmentReason?: string }) => void; onHardcopy: (v: boolean) => void;
}) {
  const [amount, setAmount] = useState(((line.verifiedAmountSen ?? line.amountSen) / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState(line.finStatus === "VERIFIED" ? "" : line.finComment);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const changed = Math.round(parseFloat(amount || "0") * 100) !== (line.verifiedAmountSen ?? line.amountSen);
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Finance verification — expense #{line.lineNo}</div>
        <span className="chip bg-gray-100 text-gray-800">{line.finStatus}</span>
      </div>
      {line.checklist.length ? (
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="mb-1 text-xs font-semibold uppercase text-gray-500">Checklist — {line.category}</div>
          {line.checklist.map((c, i) => (
            <label key={i} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!checked[i]} onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })} />{c}</label>
          ))}
        </div>
      ) : null}
      {canAct ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Verified / reimbursable amount (RM)</label>
              <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              <div className="mt-0.5 text-xs text-gray-500">Claimed {rm(line.amountSen)} (never changed)</div>
            </div>
            {changed ? (
              <div>
                <label className="label">Reason for adjustment *</label>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. personal item excluded" />
              </div>
            ) : null}
          </div>
          <div>
            <label className="label">Comment / query to staff (required to query or reject)</label>
            <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-success" disabled={pending} onClick={() => onVerify({ status: "VERIFIED", verifiedAmount: amount, adjustmentReason: reason, comment: comment || undefined })}>✓ Verify</button>
            <button className="btn-warn" disabled={pending} onClick={() => onVerify({ status: "QUERIED", comment })}>? Query / request document</button>
            <button className="btn-danger" disabled={pending} onClick={() => onVerify({ status: "REJECTED", comment })}>✕ Reject line</button>
          </div>
        </>
      ) : null}
      {line.finComment ? <div className="text-sm text-gray-600">Finance comment: {line.finComment}</div> : null}
      {line.adjustments.length ? (
        <div className="text-xs text-gray-600">
          <div className="font-semibold">Amount adjustments</div>
          {line.adjustments.map((a, i) => <div key={i}>{a.at} · {a.by}: RM {a.from} → RM {a.to} — {a.reason}</div>)}
        </div>
      ) : null}
      {isFinanceStage ? (
        <label className="flex items-center gap-2 border-t border-gray-100 pt-3 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={Boolean(line.hardcopy)} disabled={pending} onChange={(e) => onHardcopy(e.target.checked)} />
          Original hard copy received {line.hardcopy ? <span className="text-gray-500">({line.hardcopy})</span> : hardcopyRequired ? <span className="text-amber-700">(not yet — required by company policy)</span> : null}
        </label>
      ) : null}
    </div>
  );
}

function ClaimActions({ data, counts, pending, act }: { data: WsData; counts: Record<LineStatus, number>; pending: boolean; act: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void }) {
  const { claim } = data;
  const [remarks, setRemarks] = useState("");
  const [split, setSplit] = useState(true);
  const [adv, setAdv] = useState((claim.advanceSen / 100).toFixed(2));
  const [advReason, setAdvReason] = useState("");
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Finance remarks (sent to staff when returning / rejecting; recorded on verification)</label>
        <textarea className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      {counts.QUERIED > 0 && counts.VERIFIED > 0 ? (
        <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          <span>Partial verification: move the {counts.QUERIED} queried line(s) to a new supplementary claim returned to staff, so the verified lines can proceed to {claim.isDirectorOwnClaim ? "payment" : "the Director"} now.</span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className="btn-success" disabled={pending} onClick={() => act(() => verifyClaimAction(claim.id, remarks, split), claim.isDirectorOwnClaim ? "Verified — approved for payment (Director's own claim)." : "Verified — sent to Director.")}>
          Mark Finance Verified{claim.isDirectorOwnClaim ? " (final)" : " → Director"}
        </button>
        <button className="btn-warn" disabled={pending} onClick={() => act(() => returnClaimAction(claim.id, remarks), "Returned to staff.")}>Return whole claim to staff</button>
        <button className="btn-danger" disabled={pending} onClick={() => { if (confirm("Reject the whole claim? This is final.")) act(() => rejectClaimAction(claim.id, remarks), "Claim rejected."); }}>Reject claim</button>
      </div>
      <details className="rounded-xl border border-gray-200 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Advance payment to deduct</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input className="input" inputMode="decimal" value={adv} onChange={(e) => setAdv(e.target.value)} aria-label="Advance amount" />
          <input className="input sm:col-span-2" placeholder="Reason / advance reference *" value={advReason} onChange={(e) => setAdvReason(e.target.value)} />
        </div>
        <button className="btn-ghost btn-sm mt-2" disabled={pending} onClick={() => act(() => advanceAction(claim.id, adv, advReason), "Advance recorded.")}>Save advance</button>
      </details>
    </div>
  );
}
