"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/rbac";
import { UserError } from "@/lib/claims";
import { directorApprove, directorClarify, directorReject } from "@/lib/review";

export async function directorAction(claimId: string, action: "APPROVE" | "REJECT" | "CLARIFY", remarks: string) {
  const u = await requireRole("DIRECTOR");
  try {
    if (action === "APPROVE") await directorApprove(u, claimId, remarks || null);
    else if (action === "REJECT") await directorReject(u, claimId, remarks);
    else await directorClarify(u, claimId, remarks);
    revalidatePath("/director");
    revalidatePath(`/director/claims/${claimId}`);
    return { ok: true as const };
  } catch (e) {
    if (e instanceof UserError) return { ok: false as const, error: e.message };
    console.error(e);
    return { ok: false as const, error: "Something went wrong." };
  }
}
