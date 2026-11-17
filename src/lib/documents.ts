import "server-only";
import type { DocKind } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { sha256 } from "./crypto";
import { dHash, safeFilename, sniff, toJpeg } from "./files";
import { getFile, newKey, putFile } from "./storage";
import { canSubmitFor, canViewClaim, hasRole, type SessionUser } from "./rbac";
import { getSettings } from "./settings";
import { extractReceipt, ocrAvailable } from "./ocr";
import { UserError } from "./claims";

export interface IncomingFile {
  name: string;
  data: Buffer;
  /** Optional cropped/rotated/enhanced version produced on the phone. The original is always kept. */
  enhanced?: Buffer;
}

/**
 * Store supporting documents for an expense line. Originals are stored byte-for-byte; an enhanced
 * derivative (if any) is stored separately and linked. Re-uploading the identical file to the same
 * line is ignored (protects against double taps / retries).
 */
export async function addLineDocuments(u: SessionUser, claimId: string, lineId: string | null, files: IncomingFile[], kind: DocKind = "ORIGINAL") {
  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) throw new UserError("Claim not found.");
  const isFinance = hasRole(u, "FINANCE");
  const staffEditable = (claim.status === "DRAFT" || claim.status === "RETURNED") && (await canSubmitFor(u.id, claim.claimantId));
  // Finance may attach ADDITIONAL documents at verification; staff only while editable.
  if (!(staffEditable || (isFinance && kind === "ADDITIONAL"))) throw new UserError("Documents can no longer be changed for this claim.");
  if (lineId && !(await prisma.claimLine.findFirst({ where: { id: lineId, claimId } }))) throw new UserError("Expense line not found.");
  const s = await getSettings();
  const maxBytes = s.maxUploadMb * 1024 * 1024;
  if (files.length === 0) throw new UserError("No file received.");
  if (files.length > 20) throw new UserError("Maximum 20 files at a time.");

  const created: string[] = [];
  const order = await prisma.document.count({ where: { claimId, lineId } });
  let i = 0;
  for (const f of files) {
    if (f.data.length === 0) throw new UserError(`${f.name}: file is empty.`);
    if (f.data.length > maxBytes) throw new UserError(`${f.name}: file is larger than ${s.maxUploadMb} MB.`);
    const t = await sniff(f.data);
    if (!t) throw new UserError(`${f.name}: only photos (JPG, PNG, HEIC, WEBP) and PDF files are accepted.`);
    const hash = sha256(f.data);
    const dup = await prisma.document.findFirst({ where: { claimId, lineId, sha256: hash, removedAt: null, supersededAt: null } });
    if (dup) {
      created.push(dup.id);
      continue;
    }
    const key = await putFile(newKey(claimId, t.ext), f.data, safeFilename(f.name || `receipt${t.ext}`));
    const phash = t.kind === "image" ? await dHash(f.data) : null;
    const doc = await prisma.document.create({
      data: {
        claimId, lineId, kind, version: claim.version, pageOrder: order + i++, filename: safeFilename(f.name || `receipt${t.ext}`),
        mime: t.mime, sizeBytes: f.data.length, sha256: hash, phash, storageKey: key, uploadedById: u.id,
      },
    });
    created.push(doc.id);
    if (f.enhanced && t.kind === "image") {
      const et = await sniff(f.enhanced);
      if (et?.kind === "image" && f.enhanced.length <= maxBytes) {
        const ekey = await putFile(newKey(claimId, et.ext), f.enhanced, safeFilename(`enhanced-${f.name || "receipt"}`));
        await prisma.document.create({
          data: {
            claimId, lineId, kind: "ENHANCED", version: claim.version, derivedFromId: doc.id, pageOrder: doc.pageOrder,
            filename: safeFilename(`enhanced-${f.name || "receipt"}`).replace(/\.\w+$/, et.ext), mime: et.mime,
            sizeBytes: f.enhanced.length, sha256: sha256(f.enhanced), storageKey: ekey, uploadedById: u.id,
          },
        });
      }
    }
    await audit(prisma, { id: u.id, name: u.name }, "Document", doc.id, "UPLOAD", undefined, {
      claimId, lineId, kind, filename: doc.filename, sha256: hash, sizeBytes: doc.sizeBytes,
    });
  }
  return created;
}

/** Remove from a draft (kept as history) or supersede on a returned claim. Never physically deleted. */
export async function removeDocument(u: SessionUser, docId: string) {
  const doc = await prisma.document.findUnique({ where: { id: docId }, include: { claim: true } });
  if (!doc) throw new UserError("Document not found.");
  const c = doc.claim;
  if (!(c.status === "DRAFT" || c.status === "RETURNED") || !(await canSubmitFor(u.id, c.claimantId)))
    throw new UserError("Documents can no longer be changed for this claim.");
  if (doc.kind !== "ORIGINAL") throw new UserError("Only uploaded documents can be removed.");
  const now = new Date();
  const field = c.firstSubmittedAt ? { supersededAt: now } : { removedAt: now };
  await prisma.document.updateMany({ where: { OR: [{ id: docId }, { derivedFromId: docId }] }, data: field });
  await audit(prisma, { id: u.id, name: u.name }, "Document", docId, c.firstSubmittedAt ? "SUPERSEDE" : "REMOVE_FROM_DRAFT", { filename: doc.filename });
}

/** The image used for PDFs / OCR: the enhanced derivative if present, else the original. */
export async function bestImageFor(docId: string): Promise<{ jpeg?: Buffer; pdf?: Buffer }> {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
  if (doc.mime === "application/pdf") return { pdf: await getFile(doc.storageKey) };
  const enhanced = await prisma.document.findFirst({ where: { derivedFromId: doc.id, kind: "ENHANCED" }, orderBy: { uploadedAt: "desc" } });
  return { jpeg: await toJpeg(await getFile((enhanced ?? doc).storageKey)) };
}

/** Run OCR on one uploaded document and store the result separately (never overwritten). */
export async function runOcr(u: SessionUser, docId: string) {
  const doc = await prisma.document.findUnique({ where: { id: docId }, include: { claim: true } });
  if (!doc || !(await canViewClaim(u, doc.claim))) throw new UserError("Document not found.");
  const s = await getSettings();
  if (!s.ocrEnabled || !ocrAvailable()) return null;
  const existing = await prisma.ocrResult.findFirst({ where: { documentId: docId, error: null }, orderBy: { createdAt: "desc" } });
  if (existing) return existing;
  const input = await bestImageFor(docId);
  if (input.pdf && input.pdf.length > 20 * 1024 * 1024) return null;
  const r = await extractReceipt(input);
  const n = r.normalised;
  return prisma.ocrResult.create({
    data: {
      documentId: docId, engine: r.engine, raw: (r.data ?? {}) as object, error: r.error,
      supplier: n.supplier, supplierBrn: n.supplierBrn, supplierTin: n.supplierTin, supplierSst: n.supplierSst,
      receiptNo: n.receiptNo, docDate: n.docDate ? new Date(`${n.docDate}T00:00:00Z`) : null,
      subtotalSen: n.subtotalSen, taxSen: n.taxSen, totalSen: n.totalSen, currency: n.currency,
      description: n.description, legible: n.legible, confidence: n.confidence,
    },
  });
}
