import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/app-shell";
import { fmtDateTime, monthLabel, submissionDeadline, ymdOf, fmtDate } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/workflow";
import { googleMode } from "@/lib/google/auth";
import { Workspace, type WsData } from "./workspace";

export const metadata = { title: "Verify claim" };

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole("FINANCE");
  const { id } = await params;
  const c = await prisma.claim.findUnique({
    where: { id },
    include: {
      claimant: { include: { branch: true } },
      submittedBy: true,
      company: true,
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          category: true,
          branch: true,
          adjustments: { orderBy: { at: "asc" } },
          documents: { orderBy: { pageOrder: "asc" }, include: { ocr: { orderBy: { createdAt: "desc" } } } },
          duplicateFlags: {
            include: {
              matchedLine: {
                include: {
                  claim: { include: { claimant: true } },
                  documents: { where: { kind: "ORIGINAL", removedAt: null }, select: { id: true, filename: true, mime: true } },
                },
              },
            },
          },
        },
      },
      documents: { where: { lineId: null, removedAt: null }, orderBy: { uploadedAt: "desc" } },
      events: { orderBy: { at: "asc" } },
      versions: { orderBy: { version: "asc" }, select: { version: true, totalSen: true, createdAt: true, reason: true } },
      paymentItem: { include: { batch: true } },
      parentClaim: { select: { id: true, ref: true } },
      supplementaries: { select: { id: true, ref: true, status: true } },
    },
  });
  if (!c || c.status === "DRAFT" || c.claimant.isDemo !== u.isDemo) notFound();
  const s = await getSettings();
  const mode = await googleMode();
  const deadline = submissionDeadline(c.claimYear, c.claimMonth, s.submissionDeadlineDay);
  const enhancedFor = new Map<string, string>();
  for (const l of c.lines) for (const d of l.documents) if (d.kind === "ENHANCED" && d.derivedFromId) enhancedFor.set(d.derivedFromId, d.id);
  const decidedBy = new Map((await prisma.user.findMany({ where: { id: { in: c.lines.flatMap((l) => l.duplicateFlags.map((f) => f.decidedById).filter(Boolean) as string[]) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));

  const data: WsData = {
    claim: {
      id: c.id, ref: c.ref, status: c.status, statusLabel: STATUS_LABEL[c.status], version: c.version, monthLabel: monthLabel(c.claimYear, c.claimMonth),
      claimant: { name: c.claimant.name, employeeNo: c.claimant.employeeNo, branch: c.claimant.branch?.name ?? "", position: c.claimant.position ?? "", department: c.claimant.department ?? "", nric: c.claimant.nric ?? "", tin: c.claimant.tin ?? "" },
      company: c.company.name,
      submittedBy: c.submittedBy && c.submittedBy.id !== c.claimantId ? c.submittedBy.name : null,
      submittedAt: fmtDateTime(c.submittedAt),
      late: Boolean(c.submittedAt && c.submittedAt > deadline),
      deadline: fmtDate(deadline),
      advanceSen: c.advanceSen,
      staffRemarks: c.staffRemarks ?? "",
      financeRemarks: c.financeRemarks ?? "",
      directorRemarks: c.directorRemarks ?? "",
      isDirectorOwnClaim: c.isDirectorOwnClaim,
      isOwn: c.claimantId === u.id,
      archiveStatus: c.archiveStatus,
      driveFolderUrl: c.driveFolderUrl,
      driveMode: mode,
      parent: c.parentClaim,
      supplementaries: c.supplementaries,
      payment: c.paymentItem ? { ref: c.paymentItem.batch.ref, status: c.paymentItem.batch.status, date: fmtDate(c.paymentItem.batch.paymentDate, true), method: c.paymentItem.batch.method ?? "", bankRef: c.paymentItem.paymentRef ?? c.paymentItem.batch.bankRef ?? "", amountSen: c.paymentItem.amountSen } : null,
    },
    lines: c.lines.map((l) => {
      const originals = l.documents.filter((d) => d.kind === "ORIGINAL" && !d.removedAt);
      const ocr = originals.flatMap((d) => d.ocr).find((o) => !o.error) ?? null;
      return {
        id: l.id, lineNo: l.lineNo, expenseDate: ymdOf(l.expenseDate), category: l.category.name, glCode: l.category.glAccountCode ?? "", branch: l.branch.name,
        supplier: l.supplier, description: l.description, businessPurpose: l.businessPurpose ?? "", location: l.location ?? "", receiptNo: l.receiptNo ?? "",
        amountSen: l.amountSen, staffPaymentMethod: l.staffPaymentMethod, docIsReceipt: l.docIsReceipt, docIsEinvoice: l.docIsEinvoice,
        einvoice: { supplierTin: l.supplierTin, supplierBrn: l.supplierBrn, supplierSst: l.supplierSst, invoiceNo: l.invoiceNo, invoiceDate: ymdOf(l.invoiceDate), einvoiceUuid: l.einvoiceUuid, einvoiceStatus: l.einvoiceStatus },
        einvoiceApplies: l.category.einvoiceApplicable && ymdOf(l.expenseDate) >= s.einvoiceEffectiveDate,
        remarks: l.remarks ?? "",
        finStatus: l.finStatus, verifiedAmountSen: l.verifiedAmountSen, finComment: l.finComment ?? "",
        hardcopy: l.hardcopyReceivedAt ? `${fmtDate(l.hardcopyReceivedAt)} by ${l.hardcopyReceivedBy}` : null,
        warnings: (l.warnings as { code: string; message: string }[]) ?? [],
        checklist: (l.category.checklist as string[]) ?? [],
        specialApproval: l.category.specialApproval,
        adjustments: l.adjustments.map((a) => ({ at: fmtDateTime(a.at), by: a.byName, from: a.oldValue, to: a.newValue, reason: a.reason })),
        ocr: ocr
          ? {
              supplier: ocr.supplier, receiptNo: ocr.receiptNo, docDate: ocr.docDate ? ymdOf(ocr.docDate) : null, totalSen: ocr.totalSen, taxSen: ocr.taxSen,
              subtotalSen: ocr.subtotalSen, supplierTin: ocr.supplierTin, supplierBrn: ocr.supplierBrn, supplierSst: ocr.supplierSst, legible: ocr.legible,
              confidence: ocr.confidence, engine: ocr.engine, documentType: (ocr.raw as { document_type?: string })?.document_type ?? null,
              notes: (ocr.raw as { notes?: string })?.notes ?? null,
            }
          : null,
        docs: originals.map((d) => ({
          id: d.id, filename: d.filename, mime: d.mime, enhancedId: enhancedFor.get(d.id) ?? null, superseded: Boolean(d.supersededAt), version: d.version,
          uploadedAt: fmtDateTime(d.uploadedAt), sizeKb: Math.round(d.sizeBytes / 1024), drive: d.driveStatus,
        })),
        additional: l.documents.filter((d) => d.kind === "ADDITIONAL").map((d) => ({ id: d.id, filename: d.filename, mime: d.mime })),
        duplicates: l.duplicateFlags.map((f) => ({
          id: f.id, rule: f.rule, detail: f.detail ?? "", decision: f.decision, explanation: f.explanation ?? "",
          decidedBy: f.decidedById ? decidedBy.get(f.decidedById) ?? "" : "", decidedAt: fmtDateTime(f.decidedAt),
          match: {
            claimId: f.matchedLine.claim.id, ref: f.matchedLine.claim.ref, status: STATUS_LABEL[f.matchedLine.claim.status], claimant: f.matchedLine.claim.claimant.name,
            lineNo: f.matchedLine.lineNo, supplier: f.matchedLine.supplier, date: ymdOf(f.matchedLine.expenseDate), amountSen: f.matchedLine.amountSen,
            receiptNo: f.matchedLine.receiptNo ?? "", docs: f.matchedLine.documents,
          },
        })),
      };
    }),
    claimDocs: c.documents.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, mime: d.mime, superseded: Boolean(d.supersededAt), drive: d.driveStatus })),
    events: c.events.map((e) => ({ at: fmtDateTime(e.at), who: e.actorName, role: e.actorRole, action: e.action, to: STATUS_LABEL[e.toStatus], remarks: e.remarks ?? "" })),
    versions: c.versions.map((v) => ({ version: v.version, totalSen: v.totalSen, at: fmtDateTime(v.createdAt), reason: v.reason ?? "" })),
    hardcopyRequired: s.hardcopyRequired,
  };
  return (
    <AppShell user={u} wide>
      <Workspace data={data} />
    </AppShell>
  );
}
