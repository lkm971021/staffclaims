import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const FONT_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "assets/fonts");
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  cjk: PDFFont | null;
  /** Choose a font that can render `text`; replaces glyphs no available font can draw with "?". */
  pick(text: string, bold?: boolean): { font: PDFFont; text: string };
}

export async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ FONT_DIR, "DejaVuSans.ttf")), { subset: true });
  const bold = await doc.embedFont(await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ FONT_DIR, "DejaVuSans-Bold.ttf")), { subset: true });
  let cjk: PDFFont | null = null;
  const cjkPath = process.env.PDF_CJK_FONT; // optional single-font .ttf/.otf, e.g. NotoSansSC-Regular.otf
  if (cjkPath) {
    try {
      cjk = await doc.embedFont(await fs.readFile(/*turbopackIgnore: true*/ cjkPath), { subset: true });
    } catch (e) {
      console.warn("PDF_CJK_FONT could not be loaded:", (e as Error).message);
    }
  }
  return {
    regular,
    bold,
    cjk,
    pick(text: string, isBold = false) {
      const t = (text ?? "").replace(/[\r\n\t]+/g, " ");
      if (CJK.test(t)) {
        if (cjk) return { font: cjk, text: t };
        return { font: isBold ? bold : regular, text: t.replace(new RegExp(CJK.source, "g"), "?") };
      }
      const f = isBold ? bold : regular;
      // strip characters the font cannot encode (e.g. emoji)
      const safe = Array.from(t)
        .map((ch) => {
          try {
            f.encodeText(ch);
            return ch;
          } catch {
            return "?";
          }
        })
        .join("");
      return { font: f, text: safe };
    },
  };
}

/** Truncate text with an ellipsis to fit a width. */
export function fit(font: PDFFont, text: string, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

/** Word-wrap into lines that fit a width. */
export function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(cand, size) <= maxWidth) cur = cand;
    else {
      if (cur) lines.push(cur);
      cur = fit(font, w, size, maxWidth);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
