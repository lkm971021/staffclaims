import "server-only";
import type { DupRule, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { hamming } from "./files";

/**
 * Possible-duplicate detection across ALL staff. Flags are for Finance review only - a flag never
 * rejects or blocks a claim. Staff are only told that a possible duplicate exists; they see the
 * other claim's reference only if it is their own claim (no cross-staff disclosure).
 */
export const SIMILAR_IMAGE_MAX_DISTANCE = 2; // of 64 bits - near-identical copies only

export function normSupplier(s: string | null | undefined) {
  return (s ?? "").toUpperCase().replace(/SDN\.?\s*BHD\.?|BERHAD|ENTERPRISE|TRADING|\(M\)|[^A-Z0-9]/g, "").slice(0, 14);
}
export function normRef(s: string | null | undefined) {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
}

interface Found {
  lineId: string;
  matchedLineId: string;
  rule: DupRule;
  score: number;
  detail: string;
}

/** Statuses whose lines count as "already claimed" for duplicate purposes. */
const COUNTED = ["PENDING_FINANCE", "RETURNED", "PENDING_DIRECTOR", "CLARIFICATION", "APPROVED_FOR_PAYMENT", "PAID"] as const;

export async function detectDuplicatesForClaim(claimId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const lines = await tx.claimLine.findMany({
    where: { claimId },
    include: { documents: { where: { kind: "ORIGINAL", removedAt: null, supersededAt: null } } },
  });
  const found: Found[] = [];

  for (const l of lines) {
    // 1. identical file anywhere else (other lines, including other lines of this same claim)
    const hashes = l.documents.map((d) => d.sha256);
    if (hashes.length) {
      const same = await tx.document.findMany({
        where: {
          sha256: { in: hashes },
          kind: "ORIGINAL",
          removedAt: null,
          lineId: { not: l.id },
          OR: [{ claimId }, { claim: { status: { in: [...COUNTED] } } }],
        },
        select: { lineId: true, filename: true },
      });
      for (const s of same)
        if (s.lineId) found.push({ lineId: l.id, matchedLineId: s.lineId, rule: "FILE_HASH", score: 1, detail: `Identical file (${s.filename})` });
    }

    // 2. visually similar images
    const phashes = l.documents.map((d) => d.phash).filter((p): p is string => Boolean(p));
    if (phashes.length) {
      const candidates = await tx.document.findMany({
        where: {
          phash: { not: null },
          kind: "ORIGINAL",
          removedAt: null,
          lineId: { not: l.id },
          sha256: { notIn: hashes },
          OR: [{ claimId }, { claim: { status: { in: [...COUNTED] } } }],
          uploadedAt: { gte: new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000) },
        },
        select: { lineId: true, phash: true },
      });
      for (const c of candidates) {
        const best = Math.min(...phashes.map((p) => hamming(p, c.phash!)));
        if (best <= SIMILAR_IMAGE_MAX_DISTANCE && c.lineId)
          found.push({ lineId: l.id, matchedLineId: c.lineId, rule: "IMAGE_SIMILAR", score: 1 - best / 64, detail: `Near-identical image (distance ${best}/64)` });
      }
    }

    const sup = normSupplier(l.supplier);
    // 3. same supplier + same receipt / invoice number
    const ref = normRef(l.receiptNo || l.invoiceNo);
    if (ref.length >= 3) {
      const others = await tx.claimLine.findMany({
        where: {
          id: { not: l.id },
          OR: [{ receiptNo: { not: null } }, { invoiceNo: { not: null } }],
          AND: [{ OR: [{ claimId }, { claim: { status: { in: [...COUNTED] } } }] }],
        },
        select: { id: true, supplier: true, receiptNo: true, invoiceNo: true },
      });
      for (const o of others) {
        if (normRef(o.receiptNo || o.invoiceNo) === ref && (normSupplier(o.supplier) === sup || !sup))
          found.push({ lineId: l.id, matchedLineId: o.id, rule: "SUPPLIER_INVOICE_NO", score: 0.95, detail: `Same supplier and receipt no. ${l.receiptNo || l.invoiceNo}` });
      }
    }

    // 3b. OCR-read receipt number + total match another document (catches re-photographed receipts)
    const myOcr = await tx.ocrResult.findMany({
      where: { documentId: { in: l.documents.map((d) => d.id) }, error: null, receiptNo: { not: null }, totalSen: { not: null } },
    });
    for (const o of myOcr) {
      const r = normRef(o.receiptNo);
      if (r.length < 3) continue;
      const others = await tx.ocrResult.findMany({
        where: {
          totalSen: o.totalSen, error: null, receiptNo: { not: null },
          document: { lineId: { not: l.id }, removedAt: null, OR: [{ claimId }, { claim: { status: { in: [...COUNTED] } } }] },
        },
        include: { document: { select: { lineId: true } } },
      });
      for (const x of others)
        if (x.document.lineId && normRef(x.receiptNo) === r)
          found.push({ lineId: l.id, matchedLineId: x.document.lineId, rule: "SUPPLIER_INVOICE_NO", score: 0.9, detail: `Receipt read by OCR matches (no. ${o.receiptNo}, same total)` });
    }

    // 4. same supplier + same date + same amount
    const sameDay = await tx.claimLine.findMany({
      where: {
        id: { not: l.id },
        expenseDate: l.expenseDate,
        amountSen: l.amountSen,
        OR: [{ claimId }, { claim: { status: { in: [...COUNTED] } } }],
      },
      select: { id: true, supplier: true },
    });
    for (const o of sameDay)
      if (normSupplier(o.supplier) === sup)
        found.push({ lineId: l.id, matchedLineId: o.id, rule: "SUPPLIER_DATE_AMOUNT", score: 0.8, detail: "Same supplier, date and amount" });
  }

  for (const f of found) {
    await tx.duplicateFlag.upsert({
      where: { lineId_matchedLineId_rule: { lineId: f.lineId, matchedLineId: f.matchedLineId, rule: f.rule } },
      update: {},
      create: f,
    });
  }
  return found;
}
