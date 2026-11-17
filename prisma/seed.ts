/**
 * Reference-data seed (safe to re-run; it only inserts missing rows and never overwrites
 * values an administrator has changed).
 * Sources: "REIMBURSEMENT CLAIMS TEMPLATE" data-validation lists and
 * "SOP - PETTY CASH POLICY (ALL BM)" section 14 (company information).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COMPANIES = [
  {
    code: "PBP",
    name: "PLAN B PHYSIO SDN. BHD.",
    brn: "202301051828 (1545742-H)",
    tin: "C 58461983090",
    sstNo: "W10-2504-32000014",
    address: "LG-19, PJ MIDTOWN, JALAN KEMAJUAN, SEKSYEN 13, 46200 PETALING JAYA, SELANGOR.",
    email: "planbfinanceacc@gmail.com",
    phone: "+6012-370 4641 (Midtown)",
    isHolding: true,
  },
  {
    code: "PBPS",
    name: "PLAN B PHYSIO SOUTH SDN. BHD.",
    brn: "202501030330 (1631742-D)",
    tin: "C 60256546040",
    sstNo: null,
    address: "NO. 12, JALAN PERTAMA 4, PUSAT PERDAGANGAN DANGA UTAMA, 81300 JOHOR BAHRU, JOHOR MALAYSIA.",
    email: "planbfinanceacc@gmail.com",
    phone: null,
    isHolding: false,
  },
];

// Template branch list, mapped to companies per the Petty Cash SOP.
const BRANCHES = [
  { code: "MIDTOWN", name: "PJ MIDTOWN", company: "PBP", isAll: false },
  { code: "UPTOWN", name: "PJ UPTOWN", company: "PBP", isAll: false },
  { code: "PLANV", name: "PJ MIDTOWN (PLAN V)", company: "PBP", isAll: false },
  { code: "JBSUTERA", name: "JB SUTERA - PLAN B PHYSIO SOUTH", company: "PBPS", isAll: false },
  { code: "ALL", name: "ALL", company: "PBP", isAll: true },
];

// Exact list from the template's Expense Category validation (spelling preserved).
const CATEGORIES = [
  "ADVERTISEMENT", "ACCOMODATION EXPENSES", "BRANDING & MERCHANSISE EXPENSES", "CLEANING EXPENSES",
  "COURIER & POSTAGE CHARGES", "CUSTOM DUTIES AND TAXES", "ELECTRICITY", "ENTERTAINMENT WITH CUSTOMER",
  "ENTERTAINMENT WITH STAFF", "GENERAL EXPENSES", "GIFTS AND DONATIONS", "MARKETING FEE", "MACHINERY",
  "SHOP EQUIPMENT", "PHYSIOTHERAPY EQUIPMENT", "PILATES EQUIPMENT", "FURNITURE & FITTINGS",
  "OFFICE INTERNET CHARGES", "OFFICE PHONE MOBILE PLAN CHARGES", "OFFICE REFRESHMENT", "PARKING", "PETROL",
  "PRINTING", "PROFESSIONAL FEE", "SHIPPING & DELIVERY FEE", "SHOOTING FEE", "STAMPING FEE", "STATIONERY",
  "STAFF WELFARE", "TOLL", "TRAVELLING EXPENSES", "UPKEEP OF EQUIPMENT", "UPKEEP OF FURNITURE & FITTINGS",
  "UPKEEP OF SHOP EQUIPMENT", "WATER",
];

// Defaults drawn from the Petty Cash SOP; all are editable in Admin > Categories.
const BASE_CHECKLIST = [
  "Supplier name shown",
  "Date shown and within the claim month",
  "Amount agrees to receipt / invoice",
  "Description of item / service shown",
  "Business purpose stated",
  "Not a screenshot or e-wallet transfer only (payment proof is not expense proof)",
  "No personal items included",
];
const LOCATION_CATEGORIES = new Set(["PARKING", "TOLL", "PETROL", "TRAVELLING EXPENSES", "ACCOMODATION EXPENSES"]);
const ASSET_CATEGORIES = new Set([
  "MACHINERY", "SHOP EQUIPMENT", "PHYSIOTHERAPY EQUIPMENT", "PILATES EQUIPMENT", "FURNITURE & FITTINGS",
]);
const ENTERTAINMENT = new Set(["ENTERTAINMENT WITH CUSTOMER", "ENTERTAINMENT WITH STAFF", "GIFTS AND DONATIONS"]);

const SETTINGS: Record<string, unknown> = {
  submissionDeadlineDay: 5, // claims for month M due by this day of month M+1
  paymentTargetDay: 16, // target payment day of month M+1
  reminderDaysBeforeDeadline: [3, 1],
  directorOverdueDays: 3,
  einvoiceEffectiveDate: "2026-07-01",
  einvoiceFields: {
    supplierTin: "optional",
    supplierBrn: "optional",
    supplierSst: "optional",
    invoiceNo: "optional",
    invoiceDate: "optional",
    einvoiceUuid: "optional",
    einvoiceStatus: "optional",
  },
  reimbursementMethods: ["INSTANT TRANSFER (OCBC)", "TRANSFER WITH SALARY", "PETTY CASH", "CHEQUE"],
  staffPaymentMethods: [
    { value: "CASH", label: "Cash" },
    { value: "PERSONAL_CARD", label: "Personal debit / credit card" },
    { value: "E_WALLET", label: "e-Wallet (TNG, GrabPay, etc.)" },
    { value: "ONLINE_TRANSFER", label: "Personal online transfer" },
    { value: "OTHER", label: "Other" },
  ],
  hardcopyRequired: true, // Petty Cash SOP s.12: scan alone not sufficient for LHDN - warning only
  retentionYears: 7,
  financialYearEndMonth: 12,
  driveRootFolderName: "STAFF EXPENSE CLAIMS (APP)",
  masterSheetId: null,
  ocrEnabled: true,
  formNotes: [
    "Ensure all the claims receipts / invoices are submitted to the Finance Department before 5th of the following month and approved by Director.",
    "The Expenses Reimbursement Form must be approved by the Director.",
    "Ensure the original supporting documentation / receipt is kept and handed to Finance within one month the expense incurred.",
  ],
  maxUploadMb: 15,
};

async function main() {
  for (const c of COMPANIES) {
    await prisma.company.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  const companies = await prisma.company.findMany();
  const cid = (code: string) => companies.find((c) => c.code === code)!.id;

  let order = 0;
  for (const b of BRANCHES) {
    await prisma.branch.upsert({
      where: { code: b.code },
      update: {},
      create: { code: b.code, name: b.name, companyId: cid(b.company), isAll: b.isAll, sortOrder: order++ },
    });
  }

  order = 0;
  for (const name of CATEGORIES) {
    const checklist = [...BASE_CHECKLIST];
    if (LOCATION_CATEGORIES.has(name)) checklist.push("Location / route stated");
    if (ASSET_CATEGORIES.has(name)) checklist.push("Prior approval obtained (fixed asset - Petty Cash SOP s.6)");
    if (ENTERTAINMENT.has(name)) checklist.push("Approval for entertainment / gifts obtained; attendees or recipient stated");
    await prisma.expenseCategory.upsert({
      where: { name },
      update: {},
      create: {
        name,
        sortOrder: order++,
        requiresLocation: LOCATION_CATEGORIES.has(name),
        specialApproval: ASSET_CATEGORIES.has(name) || ENTERTAINMENT.has(name),
        checklist,
      },
    });
  }

  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }
  console.log("Reference data seeded: companies, branches, categories, settings.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
