import "server-only";
import sharp from "sharp";

export const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const ALLOWED_DOC = ["application/pdf"];

export interface Sniffed {
  mime: string;
  ext: string;
  kind: "image" | "pdf";
}

/** Identify the real file type from its bytes (the browser-supplied type is not trusted). */
export async function sniff(buf: Buffer): Promise<Sniffed | null> {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: ".pdf", kind: "pdf" };
  try {
    const meta = await sharp(buf, { failOn: "error" }).metadata();
    const map: Record<string, Sniffed> = {
      jpeg: { mime: "image/jpeg", ext: ".jpg", kind: "image" },
      png: { mime: "image/png", ext: ".png", kind: "image" },
      webp: { mime: "image/webp", ext: ".webp", kind: "image" },
      heif: { mime: "image/heic", ext: ".heic", kind: "image" },
    };
    return (meta.format && map[meta.format]) || null;
  } catch {
    return null;
  }
}

/**
 * 64-bit difference hash (dHash) as 16 hex chars, computed on the trimmed, contrast-normalised image.
 * Used only to catch near-identical copies (the same image re-saved / re-compressed / screenshotted).
 * Re-photographed receipts are caught by the receipt-number, supplier/date/amount and OCR rules instead,
 * because receipts printed on the same template look alike to any perceptual hash.
 */
export async function dHash(buf: Buffer): Promise<string | null> {
  try {
    const px = await sharp(buf).rotate().trim({ threshold: 30 }).grayscale().normalise().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    let hex = "";
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return null;
  }
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Normalise any image (incl. HEIC) to an upright JPEG for PDF embedding / OCR. */
export async function toJpeg(buf: Buffer, maxSide = 2400, quality = 85): Promise<Buffer> {
  return sharp(buf).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

export function safeFilename(name: string) {
  return name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "file";
}
