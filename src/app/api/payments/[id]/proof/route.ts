import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { sniff, safeFilename } from "@/lib/files";
import { getFile, newKey, putFile } from "@/lib/storage";
import { fileResponse } from "@/lib/api";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Upload payment proof (bank transfer slip) for a DRAFT batch, before marking it Paid. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || !hasRole(u, "FINANCE")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await ctx.params;
  const b = await prisma.paymentBatch.findUnique({ where: { id } });
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (b.status !== "DRAFT") return NextResponse.json({ error: "Upload proof before marking the batch as Paid." }, { status: 400 });
  const f = (await req.formData()).get("file");
  if (!(f instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const data = Buffer.from(await f.arrayBuffer());
  const t = await sniff(data);
  if (!t || data.length > 15 * 1024 * 1024) return NextResponse.json({ error: "Upload a PDF or image up to 15 MB." }, { status: 400 });
  const key = newKey(`batch-${b.id}`, t.ext);
  await putFile(key, data);
  await prisma.paymentBatch.update({ where: { id }, data: { proofDocKey: key, proofDocName: safeFilename(`${b.ref} - payment proof${t.ext}`) } });
  await audit(prisma, { id: u.id, name: u.name }, "PaymentBatch", id, "UPLOAD_PROOF", undefined, { filename: f.name, sizeBytes: data.length });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || !hasRole(u, "FINANCE")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await ctx.params;
  const b = await prisma.paymentBatch.findUnique({ where: { id } });
  if (!b?.proofDocKey) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ext = b.proofDocKey.split(".").pop();
  return fileResponse(await getFile(b.proofDocKey), ext === "pdf" ? "application/pdf" : "image/jpeg", b.proofDocName ?? "proof", false);
}
