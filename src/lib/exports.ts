import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, rgb } from "pdf-lib";
import { fit, loadFonts } from "./pdf/fonts";
import { fmtDateTime } from "./time";

export type Cell = string | number | null;
export interface Table {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Cell[][];
  /** indexes of columns holding RM decimal numbers */
  money?: number[];
  totals?: boolean;
  widths?: number[];
  /** columns to print in PDF (wide listings are unreadable on paper; Excel/CSV keep every column) */
  pdfColumns?: number[];
}

export async function toXlsx(tables: Table[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Staff Claims System";
  wb.created = new Date();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"), { views: [{ state: "frozen", ySplit: t.subtitle ? 3 : 1 }] });
    if (t.subtitle) {
      ws.addRow([t.title]).font = { bold: true, size: 13 };
      ws.addRow([t.subtitle]).font = { italic: true, color: { argb: "FF6B7280" } };
    }
    const hr = ws.addRow(t.headers);
    hr.font = { bold: true };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    for (const r of t.rows) ws.addRow(r.map((v) => (v === null ? "" : v)));
    if (t.totals && t.money?.length) {
      const tr = ws.addRow(t.headers.map((_, i) => (i === 0 ? "TOTAL" : t.money!.includes(i) ? t.rows.reduce((a, r) => a + (typeof r[i] === "number" ? (r[i] as number) : 0), 0) : "")));
      tr.font = { bold: true };
    }
    for (const i of t.money ?? []) ws.getColumn(i + 1).numFmt = "#,##0.00;(#,##0.00)";
    t.headers.forEach((h, i) => {
      const max = Math.max(h.length, ...t.rows.slice(0, 500).map((r) => String(r[i] ?? "").length));
      ws.getColumn(i + 1).width = Math.min(48, Math.max(9, max + 2));
    });
    ws.autoFilter = { from: { row: t.subtitle ? 3 : 1, column: 1 }, to: { row: t.subtitle ? 3 : 1, column: t.headers.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(t: Table): Buffer {
  const esc = (v: Cell) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.headers.map(esc).join(","), ...t.rows.map((r) => r.map((v, i) => (typeof v === "number" && t.money?.includes(i) ? v.toFixed(2) : esc(v))).join(","))];
  return Buffer.from("﻿" + lines.join("\r\n"), "utf8"); // BOM so Excel opens UTF-8 correctly
}

/** Landscape A4 table PDF with repeating header, page numbers and totals. */
export async function toPdf(full: Table, companyLine = ""): Promise<Buffer> {
  const cols = full.pdfColumns;
  const t: Table = cols
    ? { ...full, headers: cols.map((i) => full.headers[i]), rows: full.rows.map((r) => cols.map((i) => r[i])), money: full.money?.filter((m) => cols.includes(m)).map((m) => cols.indexOf(m)), widths: undefined }
    : full;
  const doc = await PDFDocument.create();
  const f = await loadFonts(doc);
  const W = 841.89;
  const H = 595.28;
  const M = 24;
  const size = 7;
  const avail = W - 2 * M;
  const base = t.widths ?? t.headers.map((h, i) => Math.max(h.length, ...t.rows.slice(0, 200).map((r) => Math.min(40, String(r[i] ?? "").length))));
  const sum = base.reduce((a, b) => a + b, 0);
  const widths = base.map((b) => (b / sum) * avail);
  let page = doc.addPage([W, H]);
  let y = H - M;
  const txt = (s: string, x: number, yy: number, w: number, bold = false, right = false, sz = size, color = rgb(0.1, 0.1, 0.12)) => {
    const { font, text } = f.pick(s, bold);
    const v = fit(font, text, sz, w - 4);
    const xx = right ? x + w - 2 - font.widthOfTextAtSize(v, sz) : x + 2;
    page.drawText(v, { x: xx, y: yy, size: sz, font, color });
  };
  const header = () => {
    txt(t.title, M, y - 12, avail, true, false, 12);
    y -= 16;
    if (t.subtitle || companyLine) {
      txt([companyLine, t.subtitle].filter(Boolean).join(" · "), M, y - 9, avail, false, false, 7.5, rgb(0.4, 0.42, 0.46));
      y -= 12;
    }
    y -= 6;
    page.drawRectangle({ x: M, y: y - 12, width: avail, height: 13, color: rgb(0.94, 0.95, 0.96) });
    let x = M;
    t.headers.forEach((h, i) => {
      txt(h, x, y - 9, widths[i], true, t.money?.includes(i));
      x += widths[i];
    });
    y -= 14;
  };
  header();
  const row = (r: Cell[], bold = false) => {
    if (y < M + 20) {
      page = doc.addPage([W, H]);
      y = H - M;
      header();
    }
    let x = M;
    r.forEach((v, i) => {
      const isMoney = t.money?.includes(i) && typeof v === "number";
      const s = isMoney ? (v as number).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? "");
      txt(s, x, y - 8, widths[i], bold, Boolean(isMoney));
      x += widths[i];
    });
    page.drawLine({ start: { x: M, y: y - 11 }, end: { x: M + avail, y: y - 11 }, thickness: 0.3, color: rgb(0.85, 0.86, 0.88) });
    y -= 12;
  };
  t.rows.forEach((r) => row(r));
  if (t.totals && t.money?.length) row(t.headers.map((_, i) => (i === 0 ? "TOTAL" : t.money!.includes(i) ? t.rows.reduce((a, r) => a + (typeof r[i] === "number" ? (r[i] as number) : 0), 0) : "")), true);
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const { font } = f.pick("x");
    p.drawText(`Generated ${fmtDateTime(new Date())} (MYT) · page ${i + 1} of ${pages.length}`, { x: M, y: 10, size: 6.5, font, color: rgb(0.45, 0.45, 0.5) });
  });
  doc.setTitle(t.title);
  return Buffer.from(await doc.save());
}

export function download(data: Buffer, filename: string, mime: string, inline = false) {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.\- ()]+/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function respond(t: Table | Table[], format: string, baseName: string) {
  const tables = Array.isArray(t) ? t : [t];
  if (format === "csv") return download(toCsv(tables[0]), `${baseName}.csv`, "text/csv; charset=utf-8");
  if (format === "pdf") return download(await toPdf(tables[0]), `${baseName}.pdf`, "application/pdf", true);
  return download(await toXlsx(tables), `${baseName}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
