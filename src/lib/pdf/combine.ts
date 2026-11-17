import "server-only";
import { PDFDocument, rgb } from "pdf-lib";
import { loadFonts } from "./fonts";

export type CombineItem = { type: "image"; jpeg: Buffer; label?: string } | { type: "pdf"; bytes: Buffer; label?: string };

const A4: [number, number] = [595.28, 841.89];

/**
 * Combine receipt images and PDFs into one audit PDF. Each image goes on its own A4 page
 * (orientation chosen to suit the image), scaled to fit with margins; PDF pages are copied as-is.
 * A small footer stamps every page with the claim reference and page number.
 */
export async function combineToPdf(items: CombineItem[], stamp: string): Promise<Buffer> {
  const out = await PDFDocument.create();
  const fonts = await loadFonts(out);
  for (const it of items) {
    if (it.type === "image") {
      const img = await out.embedJpg(it.jpeg);
      const landscape = img.width > img.height * 1.15;
      const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
      const page = out.addPage([pw, ph]);
      const margin = 28;
      const availW = pw - margin * 2;
      const availH = ph - margin * 2 - 16;
      const scale = Math.min(availW / img.width, availH / img.height, 2);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (pw - w) / 2, y: margin + 16 + (availH - h) / 2, width: w, height: h });
      if (it.label) (page as unknown as { __label?: string }).__label = it.label;
    } else {
      const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => {
        out.addPage(p);
        if (it.label) (p as unknown as { __label?: string }).__label = it.label;
      });
    }
  }
  const total = out.getPageCount();
  out.getPages().forEach((p, i) => {
    const label = (p as unknown as { __label?: string }).__label;
    const { font, text } = fonts.pick(`${stamp}${label ? " · " + label : ""} · page ${i + 1} of ${total}`);
    const { width } = p.getSize();
    p.drawText(text, { x: Math.max(12, width - 12 - font.widthOfTextAtSize(text, 7)), y: 8, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  });
  out.setTitle(stamp);
  out.setProducer("Staff Claims System");
  out.setCreationDate(new Date());
  return Buffer.from(await out.save());
}
