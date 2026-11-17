import { prisma } from "./db";

export type EinvoiceFieldMode = "required" | "optional" | "hidden";
export interface AppSettings {
  submissionDeadlineDay: number;
  paymentTargetDay: number;
  reminderDaysBeforeDeadline: number[];
  directorOverdueDays: number;
  einvoiceEffectiveDate: string;
  einvoiceFields: Record<
    "supplierTin" | "supplierBrn" | "supplierSst" | "invoiceNo" | "invoiceDate" | "einvoiceUuid" | "einvoiceStatus",
    EinvoiceFieldMode
  >;
  reimbursementMethods: string[];
  staffPaymentMethods: { value: string; label: string }[];
  hardcopyRequired: boolean;
  retentionYears: number;
  financialYearEndMonth: number;
  driveRootFolderName: string;
  masterSheetId: string | null;
  ocrEnabled: boolean;
  formNotes: string[];
  maxUploadMb: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  submissionDeadlineDay: 5,
  paymentTargetDay: 16,
  reminderDaysBeforeDeadline: [3, 1],
  directorOverdueDays: 3,
  einvoiceEffectiveDate: "2026-07-01",
  einvoiceFields: {
    supplierTin: "optional", supplierBrn: "optional", supplierSst: "optional", invoiceNo: "optional",
    invoiceDate: "optional", einvoiceUuid: "optional", einvoiceStatus: "optional",
  },
  reimbursementMethods: ["INSTANT TRANSFER (OCBC)", "TRANSFER WITH SALARY", "PETTY CASH", "CHEQUE"],
  staffPaymentMethods: [
    { value: "CASH", label: "Cash" },
    { value: "PERSONAL_CARD", label: "Personal debit / credit card" },
    { value: "E_WALLET", label: "e-Wallet" },
    { value: "ONLINE_TRANSFER", label: "Personal online transfer" },
    { value: "OTHER", label: "Other" },
  ],
  hardcopyRequired: true,
  retentionYears: 7,
  financialYearEndMonth: 12,
  driveRootFolderName: "STAFF EXPENSE CLAIMS (APP)",
  masterSheetId: null,
  ocrEnabled: true,
  formNotes: [],
  maxUploadMb: 15,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as AppSettings;
}

export async function setSetting(key: keyof AppSettings, value: unknown, byName: string) {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as never, updatedBy: byName },
    create: { key, value: value as never, updatedBy: byName },
  });
}

/** Is the e-Invoice section applicable for this expense date / category? */
export function einvoiceApplies(s: AppSettings, expenseYmd: string, categoryApplicable: boolean) {
  return categoryApplicable && expenseYmd >= s.einvoiceEffectiveDate;
}
