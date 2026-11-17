"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelBatchAction, postBatchAction, removeFromBatchAction, updateBatchAction } from "@/app/actions/finance";

interface Item { claimId: string; ref: string; claimant: string; month: string; amountSen: number; paymentRef: string }
interface B { id: string; ref: string; status: string; paymentDate: string; method: string; bankRef: string; remarks: string; proofName: string | null; proofDrive: boolean; items: Item[] }
const rm = (s: number) => `RM ${(s / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BatchEditor({ batch, methods }: { batch: B; methods: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState({ paymentDate: batch.paymentDate, method: batch.method, bankRef: batch.bankRef, remarks: batch.remarks });
  const [refs, setRefs] = useState<Record<string, string>>(Object.fromEntries(batch.items.map((i) => [i.claimId, i.paymentRef])));
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const draft = batch.status === "DRAFT";
  const total = batch.items.reduce((a, i) => a + i.amountSen, 0);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { tone: "green", text: ok } : { tone: "red", text: r.error ?? "Failed" });
      router.refresh();
    });
  const save = () => updateBatchAction(batch.id, { ...d, itemRefs: refs });

  async function uploadProof(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch(`/api/payments/${batch.id}/proof`, { method: "POST", body: fd });
    const j = await r.json();
    setMsg(r.ok ? { tone: "green", text: "Payment proof uploaded." } : { tone: "red", text: j.error });
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card overflow-x-auto lg:col-span-2">
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">Claim</th><th className="th">Employee</th><th className="th">Month</th><th className="th">Payment ref (optional, per staff)</th><th className="th text-right">Amount</th>{draft ? <th className="th" /> : null}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {batch.items.map((i) => (
              <tr key={i.claimId}>
                <td className="td"><a className="font-semibold text-blue-700 underline" href={`/finance/claims/${i.claimId}`}>{i.ref}</a></td>
                <td className="td">{i.claimant}</td><td className="td">{i.month}</td>
                <td className="td">{draft ? <input className="input !py-1.5 !text-sm" value={refs[i.claimId] ?? ""} onChange={(e) => setRefs({ ...refs, [i.claimId]: e.target.value })} /> : i.paymentRef || "—"}</td>
                <td className="td text-right num font-semibold">{rm(i.amountSen)}</td>
                {draft ? <td className="td"><button className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => removeFromBatchAction(batch.id, i.claimId), "Removed.")}>Remove</button></td> : null}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50"><tr><td className="td font-bold" colSpan={4}>Batch total ({batch.items.length} claims)</td><td className="td text-right font-bold num">{rm(total)}</td>{draft ? <td /> : null}</tr></tfoot>
        </table>
      </div>
      <div className="card space-y-3 p-4">
        <div className="font-semibold">Payment details</div>
        <div><label className="label">Payment date *</label><input type="date" className="input" disabled={!draft} value={d.paymentDate} onChange={(e) => setD({ ...d, paymentDate: e.target.value })} /></div>
        <div>
          <label className="label">Payment method *</label>
          <select className="input" disabled={!draft} value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}>
            <option value="">Choose…</option>{methods.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div><label className="label">Bank / payment reference *</label><input className="input" disabled={!draft} value={d.bankRef} onChange={(e) => setD({ ...d, bankRef: e.target.value })} placeholder="Or enter one per staff in the table" /></div>
        <div><label className="label">Remarks</label><textarea className="input" rows={2} disabled={!draft} value={d.remarks} onChange={(e) => setD({ ...d, remarks: e.target.value })} /></div>
        <div className="text-sm">
          Payment proof: {batch.proofName ? <a className="underline" target="_blank" href={`/api/payments/${batch.id}/proof`}>{batch.proofName}</a> : "none"}{batch.proofDrive ? " (in Drive)" : ""}
          {draft ? <input type="file" accept="application/pdf,image/*" className="mt-1 block text-xs" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} /> : null}
        </div>
        {msg ? <div className={`rounded-lg px-3 py-2 text-sm ${msg.tone === "red" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div> : null}
        {draft ? (
          <div className="space-y-2">
            <button className="btn-ghost w-full" disabled={pending} onClick={() => run(save, "Saved.")}>Save details</button>
            <button
              className="btn-success w-full"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Mark all ${batch.items.length} claims (${rm(total)}) as PAID? This cannot be undone.`)) return;
                start(async () => {
                  const s1 = await save();
                  if (!s1.ok) return setMsg({ tone: "red", text: s1.error ?? "Failed" });
                  const r = await postBatchAction(batch.id);
                  setMsg(r.ok ? { tone: "green", text: "Batch marked as paid. Staff have been notified." } : { tone: "red", text: r.error });
                  router.refresh();
                });
              }}
            >
              Mark batch as PAID
            </button>
            <button className="btn-ghost w-full text-red-700" disabled={pending} onClick={() => { if (confirm("Cancel this draft batch? Claims return to the payment list.")) run(() => cancelBatchAction(batch.id), "Batch cancelled."); }}>Cancel batch</button>
          </div>
        ) : <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">This batch is recorded as paid and locked. Payment records cannot be changed.</div>}
      </div>
    </div>
  );
}
