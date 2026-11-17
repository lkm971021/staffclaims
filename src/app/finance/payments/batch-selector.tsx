"use client";
import { useState, useTransition } from "react";
import { createBatchAction } from "@/app/actions/finance";

interface Row { id: string; ref: string; company: string; companyId: string; claimant: string; month: string; amountSen: number; approvedAt: string; own: boolean }
const rm = (s: number) => `RM ${(s / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BatchSelector({ rows }: { rows: Row[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const chosen = rows.filter((r) => sel.has(r.id));
  const companies = new Set(chosen.map((r) => r.companyId));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="card overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={sel.size === rows.length && rows.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
            <th className="th">Claim</th><th className="th">Company</th><th className="th">Employee</th><th className="th">Month</th><th className="th">Approved</th><th className="th text-right">Approved amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className={sel.has(r.id) ? "bg-blue-50" : ""}>
              <td className="td"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.ref}`} /></td>
              <td className="td"><a className="font-semibold text-blue-700 underline" href={`/finance/claims/${r.id}`}>{r.ref}</a>{r.own ? <span className="ml-1 text-xs text-violet-700">Director&apos;s own (Finance final)</span> : null}</td>
              <td className="td text-xs">{r.company}</td><td className="td">{r.claimant}</td><td className="td">{r.month}</td><td className="td text-gray-500">{r.approvedAt}</td>
              <td className="td text-right num font-semibold">{rm(r.amountSen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 p-3">
        <div className="text-sm">{chosen.length} selected · <b className="num">{rm(chosen.reduce((a, r) => a + r.amountSen, 0))}</b></div>
        {companies.size > 1 ? <div className="text-sm text-red-700">A batch can only contain claims of one company.</div> : null}
        {err ? <div className="text-sm text-red-700">{err}</div> : null}
        <button
          className="btn-primary ml-auto"
          disabled={pending || chosen.length === 0 || companies.size > 1}
          onClick={() => start(async () => { const r = await createBatchAction(chosen.map((c) => c.id)); if (r && !r.ok) setErr(r.error); })}
        >
          Create payment batch
        </button>
      </div>
    </div>
  );
}
