import "server-only";
import { promises as fs } from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { google, type sheets_v4 } from "googleapis";
import { authedClient } from "./auth";
import { MOCK_ROOT } from "./drive";

export type Cell = string | number | null;

export interface TabSpec {
  name: string;
  headers: readonly string[];
}

/**
 * Upsert-by-key sheet writer. Column A holds a unique key; syncing the same claim twice updates its
 * rows in place (never duplicates). Rows whose key starts with `prefix` but are no longer present are removed.
 */
export interface SheetsAdapter {
  mode: "live" | "mock";
  createSpreadsheet(title: string, tabs: TabSpec[], parentFolderId?: string): Promise<string>;
  ensureTabs(id: string, tabs: TabSpec[]): Promise<void>;
  replaceGroup(id: string, tab: string, prefix: string, rows: Cell[][]): Promise<void>;
  replaceAll(id: string, tab: TabSpec, rows: Cell[][]): Promise<void>;
  url(id: string): string;
}

const colLetter = (n: number) => {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

class LiveSheets implements SheetsAdapter {
  mode = "live" as const;
  constructor(private s: sheets_v4.Sheets, private auth: NonNullable<Awaited<ReturnType<typeof authedClient>>>) {}

  async createSpreadsheet(title: string, tabs: TabSpec[], parentFolderId?: string) {
    const r = await this.s.spreadsheets.create({
      requestBody: {
        properties: { title, locale: "en_GB", timeZone: "Asia/Kuala_Lumpur" },
        sheets: tabs.map((t) => ({ properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } })),
      },
    });
    const id = r.data.spreadsheetId!;
    for (const t of tabs) await this.writeHeader(id, t);
    if (parentFolderId) {
      const drive = google.drive({ version: "v3", auth: this.auth });
      const f = await drive.files.get({ fileId: id, fields: "parents" });
      await drive.files.update({ fileId: id, addParents: parentFolderId, removeParents: (f.data.parents ?? []).join(","), fields: "id" });
    }
    return id;
  }

  private async writeHeader(id: string, t: TabSpec) {
    await this.s.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${t.name}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...t.headers]] },
    });
  }

  async ensureTabs(id: string, tabs: TabSpec[]) {
    const meta = await this.s.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
    const have = new Set(meta.data.sheets?.map((s) => s.properties?.title));
    const missing = tabs.filter((t) => !have.has(t.name));
    if (missing.length) {
      await this.s.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: missing.map((t) => ({ addSheet: { properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } } })) },
      });
    }
    for (const t of tabs) await this.writeHeader(id, t); // keep headers current
  }

  private async sheetId(id: string, tab: string) {
    const meta = await this.s.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties" });
    return meta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId ?? 0;
  }

  async replaceGroup(id: string, tab: string, prefix: string, rows: Cell[][]) {
    const keys = (await this.s.spreadsheets.values.get({ spreadsheetId: id, range: `'${tab}'!A:A` })).data.values ?? [];
    const idx: number[] = [];
    keys.forEach((r, i) => {
      if (i > 0 && typeof r[0] === "string" && (r[0] === prefix || r[0].startsWith(prefix + "#"))) idx.push(i);
    });
    const width = Math.max(...rows.map((r) => r.length), 1);
    // overwrite existing rows in place
    const n = Math.min(idx.length, rows.length);
    if (n) {
      await this.s.spreadsheets.values.batchUpdate({
        spreadsheetId: id,
        requestBody: {
          valueInputOption: "RAW",
          data: rows.slice(0, n).map((r, k) => ({ range: `'${tab}'!A${idx[k] + 1}:${colLetter(width - 1)}${idx[k] + 1}`, values: [r.map((v) => v ?? "")] })),
        },
      });
    }
    // remove stale rows (bottom-up so indices stay valid)
    const stale = idx.slice(n).sort((a, b) => b - a);
    if (stale.length) {
      const sid = await this.sheetId(id, tab);
      await this.s.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: stale.map((i) => ({ deleteDimension: { range: { sheetId: sid, dimension: "ROWS", startIndex: i, endIndex: i + 1 } } })) },
      });
    }
    // append new rows
    if (rows.length > n) {
      await this.s.spreadsheets.values.append({
        spreadsheetId: id,
        range: `'${tab}'!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows.slice(n).map((r) => r.map((v) => v ?? "")) },
      });
    }
  }

  async replaceAll(id: string, tab: TabSpec, rows: Cell[][]) {
    await this.s.spreadsheets.values.clear({ spreadsheetId: id, range: `'${tab.name}'!A:ZZ` });
    await this.s.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${tab.name}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...tab.headers], ...rows.map((r) => r.map((v) => v ?? ""))] },
    });
  }

  url(id: string) {
    return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  }
}

/** Mock: an .xlsx file in ./mock-drive with identical tab/row behaviour. */
class MockSheets implements SheetsAdapter {
  mode = "mock" as const;
  private file(id: string) {
    return path.join(/*turbopackIgnore: true*/ MOCK_ROOT, `${id.replace(/^mock:/, "")}.xlsx`);
  }
  private async load(id: string) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(/*turbopackIgnore: true*/ this.file(id));
    } catch {
      /* new */
    }
    return wb;
  }
  private async save(id: string, wb: ExcelJS.Workbook) {
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(this.file(id)), { recursive: true });
    await wb.xlsx.writeFile(/*turbopackIgnore: true*/ this.file(id));
  }
  async createSpreadsheet(title: string, tabs: TabSpec[]) {
    const id = `mock:${title.replace(/[^\w -]/g, "_")}`;
    await this.ensureTabs(id, tabs);
    return id;
  }
  async ensureTabs(id: string, tabs: TabSpec[]) {
    const wb = await this.load(id);
    for (const t of tabs) {
      const ws = wb.getWorksheet(t.name) ?? wb.addWorksheet(t.name, { views: [{ state: "frozen", ySplit: 1 }] });
      ws.getRow(1).values = [...t.headers];
      ws.getRow(1).font = { bold: true };
    }
    await this.save(id, wb);
  }
  async replaceGroup(id: string, tab: string, prefix: string, rows: Cell[][]) {
    const wb = await this.load(id);
    const ws = wb.getWorksheet(tab)!;
    const keep: Cell[][] = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const k = String(row.getCell(1).value ?? "");
      if (!(k === prefix || k.startsWith(prefix + "#"))) keep.push((row.values as Cell[]).slice(1));
    });
    const header = (ws.getRow(1).values as Cell[]).slice(1);
    wb.removeWorksheet(ws.id);
    const nws = wb.addWorksheet(tab, { views: [{ state: "frozen", ySplit: 1 }] });
    nws.addRow(header).font = { bold: true };
    for (const r of [...keep, ...rows]) nws.addRow(r);
    await this.save(id, wb);
  }
  async replaceAll(id: string, tab: TabSpec, rows: Cell[][]) {
    const wb = await this.load(id);
    const old = wb.getWorksheet(tab.name);
    if (old) wb.removeWorksheet(old.id);
    const ws = wb.addWorksheet(tab.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow([...tab.headers]).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    await this.save(id, wb);
  }
  url(id: string) {
    return `mock://${id.replace(/^mock:/, "")}.xlsx`;
  }
}

export async function getSheets(): Promise<SheetsAdapter> {
  const auth = await authedClient();
  return auth ? new LiveSheets(google.sheets({ version: "v4", auth }), auth) : new MockSheets();
}
