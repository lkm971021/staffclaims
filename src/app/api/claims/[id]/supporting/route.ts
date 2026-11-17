import { NextResponse } from "next/server";
import { getCurrentUser, canViewClaim } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { buildSupportingPdf } from "@/lib/archive";
import { fileResponse, jsonError } from "@/lib/api";

export const runtime = "nodejs";

/** Live preview of the combined "Supporting Documents" PDF (before or after submission). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const c = await prisma.claim.findUnique({ where: { id } });
  if (!c || !(await canViewClaim(u, c))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const pdf = await buildSupportingPdf(id);
    return fileResponse(pdf, "application/pdf", `${c.ref} - Supporting Documents.pdf`, new URL(req.url).searchParams.get("download") === "1");
  } catch (e) {
    return jsonError(e);
  }
}
