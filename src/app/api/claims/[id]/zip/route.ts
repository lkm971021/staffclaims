import { NextResponse } from "next/server";
import { getCurrentUser, canViewClaim } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { zipClaims } from "@/lib/zip";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const c = await prisma.claim.findUnique({ where: { id } });
  if (!c || !(await canViewClaim(u, c))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return zipClaims(u, [id], `${c.ref} documents`);
}
