import { NextResponse } from "next/server";
import { getCurrentUser, canViewClaim } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getFile } from "@/lib/storage";
import { fileResponse } from "@/lib/api";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** View / download a supporting document. ?download=1 for attachment; ?enhanced=1 for the enhanced copy. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const doc = await prisma.document.findUnique({ where: { id }, include: { claim: true } });
  if (!doc || !(await canViewClaim(u, doc.claim))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  let target = doc;
  if (url.searchParams.get("enhanced") === "1") {
    const enh = await prisma.document.findFirst({ where: { derivedFromId: doc.id, kind: "ENHANCED" }, orderBy: { uploadedAt: "desc" }, include: { claim: true } });
    if (enh) target = enh;
  }
  const download = url.searchParams.get("download") === "1";
  if (download && doc.claim.claimantId !== u.id) await audit(prisma, { id: u.id, name: u.name }, "Document", target.id, "DOWNLOAD");
  return fileResponse(await getFile(target.storageKey), target.mime, target.filename, download);
}
