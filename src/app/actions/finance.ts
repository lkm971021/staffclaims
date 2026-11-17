"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LineStatus } from "@prisma/client";
import { requireRole } from "@/lib/rbac";
import { UserError } from "@/lib/claims";
import * as R from "@/lib/review";
import { enqueue } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export type Res = { ok: true; data?: unknown } | { ok: false; error: string };
async function run(fn: () => Promise<unknown>, paths: string[] = []): Promise<Res> {
  try {
    const data = await fn();
    paths.forEach((p) => revalidatePath(p));
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
const claimPaths = (id: string) => [`/finance/claims/${id}`, "/finance", "/finance/claims"];

export async function lineVerifyAction(claimId: string, lineId: string, input: { status: LineStatus; verifiedAmount?: string; comment?: string; adjustmentReason?: string }) {
  const u = await requireRole("FINANCE");
  return run(() => R.setLineVerification(u, lineId, input), claimPaths(claimId));
}
export async function hardcopyAction(claimId: string, lineId: string, received: boolean) {
  const u = await requireRole("FINANCE");
  return run(() => R.setHardcopy(u, lineId, received), claimPaths(claimId));
}
export async function advanceAction(claimId: string, amount: string, reason: string) {
  const u = await requireRole("FINANCE");
  return run(() => R.setAdvance(u, claimId, amount, reason), claimPaths(claimId));
}
export async function duplicateAction(claimId: string, flagId: string, decision: "NOT_DUPLICATE" | "DUPLICATE", explanation: string) {
  const u = await requireRole("FINANCE");
  return run(() => R.resolveDuplicate(u, flagId, decision, explanation), claimPaths(claimId));
}
export async function verifyClaimAction(claimId: string, remarks: string, splitQueried: boolean) {
  const u = await requireRole("FINANCE");
  return run(() => R.financeVerify(u, claimId, remarks || null, { splitQueried }), claimPaths(claimId));
}
export async function returnClaimAction(claimId: string, remarks: string) {
  const u = await requireRole("FINANCE");
  return run(() => R.financeReturn(u, claimId, remarks), claimPaths(claimId));
}
export async function rejectClaimAction(claimId: string, remarks: string) {
  const u = await requireRole("FINANCE");
  return run(() => R.financeReject(u, claimId, remarks), claimPaths(claimId));
}
export async function retryArchiveAction(claimId: string) {
  const u = await requireRole("FINANCE");
  return run(async () => {
    await enqueue(prisma, "ARCHIVE_CLAIM", { claimId }, `archive:${claimId}`);
    await enqueue(prisma, "SHEETS_SYNC_CLAIM", { claimId }, `sheet:${claimId}`);
    await audit(prisma, { id: u.id, name: u.name }, "Claim", claimId, "RETRY_SYNC");
  }, claimPaths(claimId));
}

// payments
export async function createBatchAction(claimIds: string[]) {
  const u = await requireRole("FINANCE");
  let id = "";
  const r = await run(async () => (id = (await R.createBatch(u, claimIds)).id), ["/finance/payments"]);
  if (r.ok) redirect(`/finance/payments/${id}`);
  return r;
}
export async function updateBatchAction(batchId: string, d: { paymentDate?: string; method?: string; bankRef?: string; remarks?: string; itemRefs?: Record<string, string> }) {
  const u = await requireRole("FINANCE");
  return run(() => R.updateBatchDetails(u, batchId, d), [`/finance/payments/${batchId}`]);
}
export async function removeFromBatchAction(batchId: string, claimId: string) {
  const u = await requireRole("FINANCE");
  return run(() => R.removeFromBatch(u, batchId, claimId), [`/finance/payments/${batchId}`]);
}
export async function cancelBatchAction(batchId: string) {
  const u = await requireRole("FINANCE");
  return run(() => R.cancelBatch(u, batchId), [`/finance/payments/${batchId}`, "/finance/payments"]);
}
export async function postBatchAction(batchId: string) {
  const u = await requireRole("FINANCE");
  return run(() => R.postBatch(u, batchId), [`/finance/payments/${batchId}`, "/finance/payments", "/finance"]);
}
