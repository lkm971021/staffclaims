import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/rbac";
import { addLineDocuments, type IncomingFile } from "@/lib/documents";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** multipart/form-data: lineId (optional), kind (ORIGINAL|ADDITIONAL), file_0..n, enhanced_0..n */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const fd = await req.formData();
    const lineId = (fd.get("lineId") as string) || null;
    const kind = fd.get("kind") === "ADDITIONAL" ? "ADDITIONAL" : "ORIGINAL";
    const files: IncomingFile[] = [];
    for (let i = 0; i < 25; i++) {
      const f = fd.get(`file_${i}`);
      if (!(f instanceof File)) break;
      const enh = fd.get(`enhanced_${i}`);
      files.push({
        name: f.name,
        data: Buffer.from(await f.arrayBuffer()),
        enhanced: enh instanceof File ? Buffer.from(await enh.arrayBuffer()) : undefined,
      });
    }
    const ids = await addLineDocuments(u, id, lineId, files, kind);
    const docs = await prisma.document.findMany({ where: { id: { in: ids } }, select: { id: true, filename: true, mime: true, sizeBytes: true } });
    return NextResponse.json({ documents: docs });
  } catch (e) {
    return jsonError(e);
  }
}
