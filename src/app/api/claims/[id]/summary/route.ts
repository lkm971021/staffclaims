import { NextResponse } from "next/server";
import { getCurrentUser, canViewClaim } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { claimInclude } from "@/lib/listing";
import { claimSummaryPdf } from "@/lib/pdf/summary";
import { getSettings } from "@/lib/settings";
import { fileResponse } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const c = await prisma.claim.findUnique({ where: { id }, include: claimInclude });
  if (!c || !(await canViewClaim(u, c))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const maskPersonal = !(c.claimantId === u.id || u.roles.includes("FINANCE") || u.roles.includes("ADMIN"));
  const pdf = await claimSummaryPdf(c, (await getSettings()).formNotes, { maskPersonal });
  return fileResponse(pdf, "application/pdf", `${c.ref} - Claim Summary.pdf`, new URL(req.url).searchParams.get("download") === "1");
}
