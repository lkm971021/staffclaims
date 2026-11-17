import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, canViewClaim, canEditClaim, hasRole } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { checkClaim } from "@/lib/claims";
import { AppShell } from "@/components/app-shell";
import { ymdOf, monthLabel, todayMY } from "@/lib/time";
import { fmt } from "@/lib/money";
import { ClaimEditor, type EditorData } from "./claim-editor";
import { ClaimView } from "@/components/claim-view";

export const metadata = { title: "Claim" };

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const claim = await prisma.claim.findUnique({
    where: { id },
    include: {
      claimant: { include: { branch: true } },
      submittedBy: true,
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          category: true,
          branch: true,
          documents: { where: { removedAt: null, supersededAt: null }, include: { ocr: true }, orderBy: { pageOrder: "asc" } },
        },
      },
      events: { orderBy: { at: "asc" } },
      paymentItem: { include: { batch: true } },
      parentClaim: { select: { id: true, ref: true } },
      supplementaries: { select: { id: true, ref: true, status: true } },
    },
  });
  if (!claim || !(await canViewClaim(u, claim))) notFound();

  // Finance/Director use their own workspaces; this page is the claimant / team-leader view.
  const editable = await canEditClaim(u, claim);
  if (!editable) {
    return (
      <AppShell user={u}>
        <ClaimView claimId={claim.id} viewer={u} backHref={hasRole(u, "FINANCE") && claim.claimantId !== u.id ? "/finance/claims" : "/staff"} />
      </AppShell>
    );
  }

  const [s, categories, branches, unattached] = await Promise.all([
    getSettings(),
    prisma.expenseCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.branch.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.document.findMany({ where: { claimId: id, lineId: null, kind: "ORIGINAL", removedAt: null, supersededAt: null } }),
  ]);
  const checks = checkClaim(claim, claim.lines, s);
  const enhancedOf = new Set(
    (await prisma.document.findMany({ where: { claimId: id, kind: "ENHANCED", removedAt: null }, select: { derivedFromId: true } })).map((d) => d.derivedFromId),
  );

  const data: EditorData = {
    claim: {
      id: claim.id,
      ref: claim.ref,
      status: claim.status,
      version: claim.version,
      month: `${claim.claimYear}-${String(claim.claimMonth).padStart(2, "0")}`,
      monthLabel: monthLabel(claim.claimYear, claim.claimMonth),
      staffRemarks: claim.staffRemarks ?? "",
      financeRemarks: claim.financeRemarks ?? "",
      claimantName: claim.claimant.name,
      forSomeoneElse: claim.claimantId !== u.id,
      everSubmitted: Boolean(claim.firstSubmittedAt),
      parentRef: claim.parentClaim?.ref ?? null,
    },
    lines: claim.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      expenseDate: ymdOf(l.expenseDate),
      categoryId: l.categoryId,
      categoryName: l.category.name,
      branchId: l.branchId,
      branchName: l.branch.name,
      supplier: l.supplier,
      description: l.description,
      businessPurpose: l.businessPurpose ?? "",
      location: l.location ?? "",
      receiptNo: l.receiptNo ?? "",
      amount: fmt(l.amountSen).replace(/,/g, ""),
      amountSen: l.amountSen,
      staffPaymentMethod: l.staffPaymentMethod,
      docIsReceipt: l.docIsReceipt,
      docIsEinvoice: l.docIsEinvoice,
      supplierTin: l.supplierTin ?? "",
      supplierBrn: l.supplierBrn ?? "",
      supplierSst: l.supplierSst ?? "",
      invoiceNo: l.invoiceNo ?? "",
      invoiceDate: ymdOf(l.invoiceDate),
      einvoiceUuid: l.einvoiceUuid ?? "",
      einvoiceStatus: l.einvoiceStatus ?? "",
      remarks: l.remarks ?? "",
      finStatus: l.finStatus,
      finComment: l.finComment ?? "",
      documents: l.documents
        .filter((d) => d.kind === "ORIGINAL")
        .map((d) => ({ id: d.id, filename: d.filename, mime: d.mime, enhanced: enhancedOf.has(d.id) })),
    })),
    unattached: unattached.map((d) => ({ id: d.id, filename: d.filename, mime: d.mime, enhanced: enhancedOf.has(d.id) })),
    categories: categories.map((c) => ({
      id: c.id, name: c.name, requiresLocation: c.requiresLocation, requiresPurpose: c.requiresPurpose, requiresReceipt: c.requiresReceipt,
      einvoiceApplicable: c.einvoiceApplicable, guidance: c.guidance ?? "",
    })),
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    defaultBranchId: claim.claimant.branchId ?? branches[0]?.id ?? "",
    today: todayMY(),
    settings: {
      einvoiceEffectiveDate: s.einvoiceEffectiveDate,
      einvoiceFields: s.einvoiceFields,
      staffPaymentMethods: s.staffPaymentMethods,
      maxUploadMb: s.maxUploadMb,
    },
    checks,
  };
  return (
    <AppShell user={u}>
      <ClaimEditor data={data} />
    </AppShell>
  );
}
