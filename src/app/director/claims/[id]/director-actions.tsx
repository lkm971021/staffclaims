"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { directorAction } from "@/app/actions/director";

export function DirectorActions({ claimId }: { claimId: string }) {
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (a: "APPROVE" | "REJECT" | "CLARIFY") =>
    start(async () => {
      setErr("");
      if (a === "REJECT" && !confirm("Reject this claim? This is final.")) return;
      const r = await directorAction(claimId, a, remarks);
      if (!r.ok) setErr(r.error);
      else router.push("/director");
    });
  return (
    <div className="card space-y-3 border-gray-900 p-4">
      <div className="font-semibold">Your decision</div>
      <textarea className="input" rows={2} placeholder="Comments (required to reject or request clarification)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <button className="btn-success py-3" disabled={pending} onClick={() => go("APPROVE")}>Approve</button>
        <button className="btn-warn py-3" disabled={pending} onClick={() => go("CLARIFY")}>Request clarification</button>
        <button className="btn-danger py-3" disabled={pending} onClick={() => go("REJECT")}>Reject</button>
      </div>
      <div className="text-xs text-gray-500">Approval sends the claim to Finance for payment. Clarification requests go to Finance, who will follow up with the staff member.</div>
    </div>
  );
}
