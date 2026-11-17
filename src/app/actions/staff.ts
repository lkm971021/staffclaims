"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/rbac";
import {
  createDraft, discardDraft, saveLine, deleteLine, submitClaim, updateClaimMeta, UserError, type LineInputT,
} from "@/lib/claims";
import { removeDocument, runOcr } from "@/lib/documents";

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function newClaimAction(formData: FormData) {
  const u = await requireUser();
  const [y, m] = String(formData.get("month") ?? "").split("-").map(Number);
  const claimantId = String(formData.get("claimantId") || u.id);
  let id = "";
  try {
    id = (await createDraft(u, { claimantId, year: y, month: m })).id;
  } catch (e) {
    redirect(`/staff?error=${encodeURIComponent(e instanceof UserError ? e.message : "Could not create claim")}`);
  }
  redirect(`/staff/claims/${id}`);
}

export async function saveLineAction(claimId: string, input: LineInputT) {
  const u = await requireUser();
  const r = await wrap(async () => (await saveLine(u, claimId, input)).id);
  revalidatePath(`/staff/claims/${claimId}`);
  return r;
}

export async function deleteLineAction(claimId: string, lineId: string) {
  const u = await requireUser();
  const r = await wrap(() => deleteLine(u, claimId, lineId));
  revalidatePath(`/staff/claims/${claimId}`);
  return r;
}

export async function removeDocAction(claimId: string, docId: string) {
  const u = await requireUser();
  const r = await wrap(() => removeDocument(u, docId));
  revalidatePath(`/staff/claims/${claimId}`);
  return r;
}

export async function ocrAction(docId: string) {
  const u = await requireUser();
  return wrap(async () => {
    const o = await runOcr(u, docId);
    if (!o) return null;
    return {
      error: o.error,
      supplier: o.supplier,
      receiptNo: o.receiptNo,
      docDate: o.docDate ? o.docDate.toISOString().slice(0, 10) : null,
      totalSen: o.totalSen,
      taxSen: o.taxSen,
      supplierTin: o.supplierTin,
      supplierBrn: o.supplierBrn,
      supplierSst: o.supplierSst,
      description: o.description,
      legible: o.legible,
      documentType: (o.raw as { document_type?: string } | null)?.document_type ?? null,
      einvoiceUuid: (o.raw as { einvoice_uuid?: string } | null)?.einvoice_uuid ?? null,
    };
  });
}

export async function updateMetaAction(claimId: string, data: { staffRemarks?: string | null; month?: string }) {
  const u = await requireUser();
  const [year, month] = (data.month ?? "").split("-").map(Number);
  const r = await wrap(() => updateClaimMeta(u, claimId, { staffRemarks: data.staffRemarks, year: year || undefined, month: month || undefined }));
  revalidatePath(`/staff/claims/${claimId}`);
  return r.ok ? { ok: true as const } : r;
}

export async function submitAction(claimId: string, key: string) {
  const u = await requireUser();
  const r = await wrap(() => submitClaim(u, claimId, key));
  revalidatePath(`/staff/claims/${claimId}`);
  revalidatePath("/staff");
  return r;
}

export async function discardAction(claimId: string) {
  const u = await requireUser();
  const r = await wrap(() => discardDraft(u, claimId));
  if (r.ok) redirect("/staff");
  return r;
}
