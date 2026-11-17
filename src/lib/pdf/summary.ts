import "server-only";
import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import type { Branch, Claim, ClaimLine, Company, ExpenseCategory, PaymentBatch, PaymentItem, User, WorkflowEvent } from "@prisma/client";
import { fit, loadFonts, wrap, type Fonts } from "./fonts";
import { fmt } from "../money";
import { expensePeriodLabel, fmtDate, fmtDateTime } from "../time";
import { STATUS_LABEL, reimbursable, submittedTotal } from "../workflow";

export type ClaimForPdf = Claim & {
  company: Company;
  claimant: User & { branch: Branch | null };
  submittedBy: User | null;
  lines: (ClaimLine & { category: ExpenseCategory; branch: Branch })[];
  events: WorkflowEvent[];
  paymentItem: (PaymentItem & { batch: PaymentBatch }) | null;
};

const INK = rgb(0.11, 0.12, 0.15);
const MUTE = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.75, 0.77, 0.8);
const HEAD_BG = rgb(1, 0.96, 0.82); // template header band
const RED = rgb(0.75, 0.1, 0.1);

/**
 * Claim Summary in the layout of the existing "REIMBURSEMENT CLAIMS FORM" template
 * (header, claimant block, line table, Sub Total / Advance / Total Reimbursement,
 * Requested / Approved / Reviewed blocks and the Finance payment section).
 * Signatures are replaced by electronic approval records (name + timestamp).
 */
export async function claimSummaryPdf(c: ClaimForPdf, formNotes: string[], opts: { maskPersonal?: boolean } = {}): Promise<Buffer> {
  const mask = (v: string | null) => (opts.maskPersonal ? (v ? "•••• (restricted)" : "") : v ?? "");
  const doc = await PDFDocument.create();
  const f = await loadFonts(doc);
  const W = 841.89;
  const H = 595.28; // A4 landscape like the template
  const M = 28;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (p: PDFPage, s: string, x: number, yy: number, size = 8, bold = false, color = INK, maxW?: number) => {
    const { font, text: t } = f.pick(s ?? "", bold);
    const out = maxW ? fit(font, t, size, maxW) : t;
    p.drawText(out, { x, y: yy, size, font, color });
  };
  const right = (p: PDFPage, s: string, xr: number, yy: number, size = 8, bold = false, color = INK) => {
    const { font, text: t } = f.pick(s, bold);
    p.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
  };

  // Header band
  page.drawRectangle({ x: M, y: y - 50, width: W - 2 * M, height: 50, color: HEAD_BG });
  text(page, `${c.company.name} ${c.company.brn ?? ""}`, M + 10, y - 18, 14, true);
  text(page, c.company.address ?? "", M + 10, y - 32, 7.5, false, MUTE, W - 2 * M - 20);
  text(page, [c.company.email, c.company.phone].filter(Boolean).join(", "), M + 10, y - 43, 7.5, false, MUTE);
  y -= 70;
  const title = c.isDirectorOwnClaim ? "DIRECTOR REIMBURSEMENT CLAIMS FORM" : "REIMBURSEMENT CLAIMS FORM";
  const { font: tf } = f.pick(title, true);
  page.drawText(title, { x: (W - tf.widthOfTextAtSize(title, 12)) / 2, y, size: 12, font: tf, color: INK });
  page.drawLine({ start: { x: (W - tf.widthOfTextAtSize(title, 12)) / 2, y: y - 2 }, end: { x: (W + tf.widthOfTextAtSize(title, 12)) / 2, y: y - 2 }, thickness: 0.8, color: INK });
  right(page, `Ref: ${c.ref}  (v${c.version})`, W - M, y, 9, true);
  y -= 22;

  // Claimant block (two columns like the template)
  const lx = M + 10;
  const rx = W / 2 + 40;
  const kv = (k: string, v: string, x: number, yy: number) => {
    text(page, k, x, yy, 8, true);
    text(page, v, x + 95, yy, 8, false, INK, 260);
  };
  const claimantName = c.claimant.nickName ? `${c.claimant.name} (${c.claimant.nickName})` : c.claimant.name;
  kv("Full Name:", claimantName, lx, y);
  kv("Date:", fmtDate(c.submittedAt ?? c.createdAt), rx, y);
  y -= 12;
  kv("Employee No.:", c.claimant.employeeNo, lx, y);
  kv("Expense Period:", expensePeriodLabel(c.claimYear, c.claimMonth), rx, y);
  y -= 12;
  kv("NRIC No.:", mask(c.claimant.nric), lx, y);
  kv("Branch:", c.claimant.branch?.name ?? "", rx, y);
  y -= 12;
  kv("TIN No.:", mask(c.claimant.tin), lx, y);
  kv("Position:", c.claimant.position ?? "", rx, y);
  y -= 12;
  kv("Department:", c.claimant.department ?? "", lx, y);
  kv("Status:", STATUS_LABEL[c.status], rx, y);
  y -= 16;

  // Line table
  const cols = [
    { k: "No.", w: 24 },
    { k: "Inv Date", w: 54 },
    { k: "Inv. No.", w: 92 },
    { k: "Description", w: 150 },
    { k: "Supplier Name", w: 120 },
    { k: "Receipt", w: 38 },
    { k: "E-Invoice", w: 42 },
    { k: "Expense Category", w: 98 },
    { k: "Branch", w: 98 },
    { k: "Amount (RM)", w: 70 },
  ];
  const tableW = cols.reduce((a, c2) => a + c2.w, 0);
  const tx = (W - tableW) / 2;
  const rowH = 14;
  const header = (p: PDFPage, yy: number) => {
    p.drawRectangle({ x: tx, y: yy - rowH + 4, width: tableW, height: rowH, color: rgb(0.93, 0.94, 0.95), borderColor: LINE, borderWidth: 0.5 });
    let x = tx;
    for (const col of cols) {
      text(p, col.k, x + 3, yy - 6, 7.5, true);
      x += col.w;
    }
  };
  header(page, y);
  y -= rowH;

  const check = (p: PDFPage, x: number, yy: number, on: boolean) => {
    p.drawRectangle({ x, y: yy - 1, width: 7, height: 7, borderColor: MUTE, borderWidth: 0.6 });
    if (on) {
      p.drawLine({ start: { x: x + 1.2, y: yy + 2.5 }, end: { x: x + 3, y: yy + 0.5 }, thickness: 1, color: INK });
      p.drawLine({ start: { x: x + 3, y: yy + 0.5 }, end: { x: x + 6, y: yy + 5.5 }, thickness: 1, color: INK });
    }
  };

  for (const l of c.lines) {
    if (y < 150) {
      page = doc.addPage([W, H]);
      y = H - M;
      header(page, y);
      y -= rowH;
    }
    let x = tx;
    const vals = [
      String(l.lineNo),
      fmtDate(l.expenseDate, true),
      l.receiptNo ?? l.invoiceNo ?? "",
      l.description,
      l.supplier,
      "",
      "",
      l.category.name,
      l.branch.name,
      "",
    ];
    cols.forEach((col, i) => {
      if (i === 5) check(page, x + col.w / 2 - 3.5, y - 6, l.docIsReceipt);
      else if (i === 6) check(page, x + col.w / 2 - 3.5, y - 6, l.docIsEinvoice);
      else if (i === 9) right(page, fmt(l.amountSen), x + col.w - 4, y - 6, 7.5);
      else text(page, vals[i], x + 3, y - 6, 7, false, INK, col.w - 6);
      x += col.w;
    });
    page.drawLine({ start: { x: tx, y: y - rowH + 4 }, end: { x: tx + tableW, y: y - rowH + 4 }, thickness: 0.4, color: LINE });
    y -= rowH;
    // Finance outcome row when the line was not verified in full
    const verifiedDiffers = l.finStatus === "VERIFIED" && l.verifiedAmountSen !== null && l.verifiedAmountSen !== l.amountSen;
    if (l.finStatus === "REJECTED" || l.finStatus === "QUERIED" || verifiedDiffers) {
      const msg =
        l.finStatus === "VERIFIED"
          ? `Finance verified amount RM ${fmt(l.verifiedAmountSen)} — ${l.finComment ?? ""}`
          : `${l.finStatus === "REJECTED" ? "REJECTED" : "QUERIED"} by Finance — ${l.finComment ?? ""}`;
      text(page, `↳ ${msg}`, tx + 30, y - 4, 7, false, RED, tableW - 40);
      y -= 11;
    }
  }

  // Totals (template: Sub Total / Advance Payment / Total Reimbursement)
  y -= 4;
  const sub = submittedTotal(c.lines);
  const anyVerified = c.lines.some((l) => l.finStatus !== "PENDING");
  const totalsX = tx + tableW - 70;
  const tot = (label: string, val: string, bold = false) => {
    right(page, label, totalsX - 6, y, 8, bold);
    right(page, val, tx + tableW - 4, y, 8, bold);
    y -= 12;
  };
  tot("Sub Total:", fmt(sub));
  tot("Advance Payment (if any):", c.advanceSen ? `(${fmt(c.advanceSen)})` : "0.00");
  if (anyVerified) tot("Total Reimbursement (Finance verified):", fmt(reimbursable(c.lines, c.advanceSen)), true);
  else tot("Total Reimbursement:", fmt(sub - c.advanceSen), true);

  // Notes
  y -= 4;
  text(page, "Notes:", M + 10, y, 8, true);
  y -= 10;
  formNotes.forEach((n, i) => {
    for (const ln of wrap(f.regular, `${i + 1}. ${n}`, 7, W - 2 * M - 20)) {
      text(page, ln, M + 10, y, 7, false, MUTE);
      y -= 9;
    }
  });
  if (c.staffRemarks) {
    text(page, `Claimant remarks: ${c.staffRemarks}`, M + 10, y, 7, false, INK, W - 2 * M - 20);
    y -= 9;
  }

  // Approval blocks
  if (y < 110) {
    page = doc.addPage([W, H]);
    y = H - M;
  }
  y -= 8;
  const ev = (action: string) => [...c.events].reverse().find((e) => e.action === action);
  const submitEv = ev("RESUBMIT") ?? ev("SUBMIT");
  const verifyEv = ev("FINANCE_VERIFY");
  const approveEv = ev("DIRECTOR_APPROVE");
  const bw = (W - 2 * M) / 3;
  const block = (i: number, title: string, name: string, line2: string, when: string) => {
    const bx = M + i * bw;
    page.drawRectangle({ x: bx + 4, y: y - 62, width: bw - 8, height: 62, borderColor: LINE, borderWidth: 0.6 });
    text(page, title, bx + 10, y - 12, 8, true);
    text(page, name || "—", bx + 10, y - 26, 9, true, INK, bw - 24);
    text(page, line2, bx + 10, y - 40, 7, false, MUTE, bw - 24);
    text(page, when ? `Date: ${when}` : "Date:", bx + 10, y - 54, 7.5, false, INK);
  };
  const onBehalf = c.submittedBy && c.submittedBy.id !== c.claimantId ? ` (submitted by ${c.submittedBy.name})` : "";
  block(0, "Requested by:", c.claimant.name, submitEv ? `Submitted electronically${onBehalf}` : "Not yet submitted", fmtDateTime(submitEv?.at));
  if (c.isDirectorOwnClaim) {
    block(1, "Approved by:", verifyEv ? "Finance verification final" : "", "Director's own claim — Finance verification is final (company rule)", fmtDateTime(verifyEv?.at));
  } else {
    block(1, "Approved by (Director):", approveEv?.actorName ?? "", approveEv ? "Approved electronically" : "Pending", fmtDateTime(approveEv?.at));
  }
  block(2, "Reviewed by (Finance):", verifyEv?.actorName ?? "", verifyEv ? "Finance verified electronically" : "Pending", fmtDateTime(verifyEv?.at));
  y -= 76;

  // Finance use only
  text(page, "For Finance Department use only", M + 10, y, 8, true);
  y -= 12;
  const pb = c.paymentItem?.batch;
  text(page, `Reimbursement Payment Date: ${pb?.status === "POSTED" ? fmtDate(pb.paymentDate, true) : ""}`, M + 10, y, 8);
  text(page, `Payment Batch: ${pb?.status === "POSTED" ? pb.ref : ""}`, W / 2, y, 8);
  y -= 12;
  text(page, `Reimbursement Payment Method: ${pb?.status === "POSTED" ? pb.method ?? "" : ""}`, M + 10, y, 8, false, pb ? RED : INK);
  text(page, `Payment Reference: ${pb?.status === "POSTED" ? c.paymentItem?.paymentRef ?? pb.bankRef ?? "" : ""}`, W / 2, y, 8);

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    text(p, `Generated ${fmtDateTime(new Date())} (MYT) · Approvals are recorded electronically; full audit trail in 05_Approval_Records · ${c.ref} · page ${i + 1} of ${pages.length}`, M, 12, 6.5, false, MUTE);
  });
  doc.setTitle(`${c.ref} - Claim Summary`);
  doc.setAuthor(c.company.name);
  doc.setProducer("Staff Claims System");
  return Buffer.from(await doc.save());
}

/** Audit trail PDF (05_Approval_Records). */
export async function auditTrailPdf(c: ClaimForPdf, extra: { at: Date; who: string; what: string }[] = []): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const f: Fonts = await loadFonts(doc);
  const W = 595.28;
  const H = 841.89;
  const M = 36;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const t = (s: string, x: number, size = 8, bold = false, maxW = W - 2 * M) => {
    const { font, text } = f.pick(s, bold);
    page.drawText(fit(font, text, size, maxW), { x, y, size, font, color: INK });
  };
  t(`${c.ref} — Approval & Audit Record`, M, 13, true);
  y -= 16;
  t(`${c.claimant.name} (${c.claimant.employeeNo}) · ${c.company.name} · ${expensePeriodLabel(c.claimYear, c.claimMonth)}`, M, 8);
  y -= 22;
  const rows = [
    ...c.events.map((e) => ({ at: e.at, who: `${e.actorName} (${e.actorRole})`, what: `${e.action}: ${e.fromStatus ?? "-"} → ${e.toStatus}${e.remarks ? " — " + e.remarks : ""}` })),
    ...extra,
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const r of rows) {
    if (y < 50) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
    t(fmtDateTime(r.at), M, 7.5, true, 90);
    t(r.who, M + 92, 7.5, false, 140);
    const { font } = f.pick(r.what);
    const lines = wrap(font, f.pick(r.what).text, 7.5, W - M - (M + 236));
    for (const ln of lines) {
      t(ln, M + 236, 7.5, false, W - M - (M + 236));
      y -= 10;
    }
    y -= 4;
  }
  doc.setTitle(`${c.ref} - Audit Trail`);
  return Buffer.from(await doc.save());
}
