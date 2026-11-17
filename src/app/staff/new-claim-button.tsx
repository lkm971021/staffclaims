"use client";
import { useState } from "react";
import { newClaimAction } from "@/app/actions/staff";

export function NewClaimButton({ defaultMonth, months, members, selfId }: { defaultMonth: string; months: { value: string; label: string }[]; members: { id: string; name: string }[]; selfId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="btn-brand w-full py-4 text-base shadow-md sm:w-auto sm:px-8">
        <span className="text-xl leading-none">+</span> NEW EXPENSE CLAIM
      </button>
    );
  return (
    <form action={newClaimAction} onSubmit={() => setBusy(true)} className="card space-y-3 p-4">
      <div className="font-semibold">New expense claim</div>
      <div>
        <label className="label" htmlFor="month">Claim month</label>
        <select id="month" name="month" defaultValue={defaultMonth} className="input">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      {members.length ? (
        <div>
          <label className="label" htmlFor="claimantId">Claim for</label>
          <select id="claimantId" name="claimantId" defaultValue={selfId} className="input">
            <option value={selfId}>Myself</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} (team member)</option>)}
          </select>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button className="btn-brand flex-1 py-3" disabled={busy}>{busy ? "Creating…" : "Start claim"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
