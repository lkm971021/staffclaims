import { requireRole } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/app-shell";
import { PageTitle } from "@/components/ui";
import { Flash } from "@/components/flash";
import { saveSettingsAction } from "@/app/actions/admin";
import { ocrAvailable, OCR_MODEL } from "@/lib/ocr";
import { emailEnabled } from "@/lib/email";

export const metadata = { title: "Settings" };
const LABELS: Record<string, string> = { supplierTin: "Supplier TIN", supplierBrn: "Supplier BRN / ID", supplierSst: "Supplier SST No.", invoiceNo: "Invoice No.", invoiceDate: "Invoice date", einvoiceUuid: "e-Invoice UUID", einvoiceStatus: "Validation status" };

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN");
  const s = await getSettings();
  const i = "input";
  const n = (name: string, label: string, v: number, help?: string) => (
    <div><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} type="number" defaultValue={v} className={i} />{help ? <div className="mt-0.5 text-xs text-gray-500">{help}</div> : null}</div>
  );
  return (
    <AppShell user={u}>
      <PageTitle title="Deadlines, payment dates, e-Invoice & system settings" />
      <Flash sp={await searchParams} />
      <form action={saveSettingsAction} className="space-y-4">
        <section className="card grid gap-3 p-4 sm:grid-cols-2">
          <div className="font-semibold sm:col-span-2">Submission & payment schedule</div>
          {n("submissionDeadlineDay", "Submission deadline (day of following month)", s.submissionDeadlineDay, "e.g. 5 → June claims due 5 July")}
          {n("paymentTargetDay", "Target payment day (day of following month)", s.paymentTargetDay, "e.g. 16 → paid by 16 July")}
          <div><label className="label">Reminder days before deadline</label><input name="reminderDays" defaultValue={s.reminderDaysBeforeDeadline.join(", ")} className={i} /></div>
          {n("directorOverdueDays", "Director approval overdue after (days)", s.directorOverdueDays)}
          <div className="sm:col-span-2"><label className="label">Reimbursement payment methods (one per line)</label><textarea name="reimbursementMethods" rows={4} defaultValue={s.reimbursementMethods.join("\n")} className={i} /></div>
        </section>
        <section className="card grid gap-3 p-4 sm:grid-cols-2">
          <div className="font-semibold sm:col-span-2">Malaysian e-Invoice information</div>
          <div><label className="label">Effective from (expense date)</label><input type="date" name="einvoiceEffectiveDate" defaultValue={s.einvoiceEffectiveDate} className={i} /><div className="mt-0.5 text-xs text-gray-500">Expenses before this date never show e-Invoice fields.</div></div>
          <div className="text-xs text-gray-500 sm:pt-6">“Required” blocks submission when missing; “optional” only shows a Finance warning. Missing e-Invoice information never automatically marks a document as invalid. Confirm requirements against LHDN guidance and the company policy.</div>
          {Object.entries(s.einvoiceFields).map(([k, v]) => (
            <div key={k}><label className="label">{LABELS[k] ?? k}</label>
              <select name={`einv_${k}`} defaultValue={v} className={i}><option value="optional">Optional</option><option value="required">Required</option><option value="hidden">Hidden</option></select></div>
          ))}
        </section>
        <section className="card grid gap-3 p-4 sm:grid-cols-2">
          <div className="font-semibold sm:col-span-2">Documents, OCR & records</div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hardcopyRequired" defaultChecked={s.hardcopyRequired} />Remind Finance to collect original hard-copy receipts</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ocrEnabled" defaultChecked={s.ocrEnabled} />Receipt OCR suggestions {ocrAvailable() ? <span className="text-xs text-gray-500">({OCR_MODEL})</span> : <span className="text-xs text-amber-700">(ANTHROPIC_API_KEY not set — OCR off)</span>}</label>
          {n("maxUploadMb", "Max upload size per file (MB)", s.maxUploadMb)}
          {n("retentionYears", "Record retention (years)", s.retentionYears, "Records are never deleted automatically.")}
          {n("financialYearEndMonth", "Financial year end month (1–12)", s.financialYearEndMonth)}
          <div><label className="label">Drive root folder name</label><input name="driveRootFolderName" defaultValue={s.driveRootFolderName} className={i} /></div>
          <div className="sm:col-span-2"><label className="label">Notes printed on the Claim Summary (one per line)</label><textarea name="formNotes" rows={4} defaultValue={s.formNotes.join("\n")} className={i} /></div>
          <div className="text-xs text-gray-500 sm:col-span-2">Email notifications: {emailEnabled() ? "enabled (SMTP configured)" : "off — set SMTP_HOST and SMTP_FROM to enable. In-app notifications always work."}</div>
        </section>
        <button className="btn-primary">Save settings</button>
      </form>
    </AppShell>
  );
}
