import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Chip } from "@/components/ui";
import { Flash } from "@/components/flash";
import { saveCategoryAction } from "@/app/actions/admin";
import { fmt } from "@/lib/money";

export const metadata = { title: "Expense categories" };

export default async function Categories({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("FINANCE", "ADMIN");
  const cats = await prisma.expenseCategory.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
  const i = "input !py-1.5 !text-sm";
  const box = (name: string, label: string, on: boolean) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} className="h-4 w-4" />{label}</label>;
  return (
    <AppShell user={u}>
      <PageTitle title="Expense categories & claim policy" sub="Configure per category: required documents and fields, Finance checklist, special approval, SQL Accounting GL code and an optional guide amount (a soft warning, never a hard limit)." />
      <Flash sp={await searchParams} />
      <div className="space-y-2">
        {[...cats, null].map((c) => (
          <details key={c?.id ?? "new"} className={`card p-3 ${c && !c.active ? "opacity-60" : ""}`}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className="font-semibold">{c ? c.name : "+ Add category"}</span>
              {c?.glAccountCode ? <Chip>GL {c.glAccountCode}</Chip> : c ? <Chip tone="amber">no GL code</Chip> : null}
              {c?.requiresLocation ? <Chip tone="blue">location</Chip> : null}
              {c?.specialApproval ? <Chip tone="violet">special approval</Chip> : null}
              {c && !c.requiresReceipt ? <Chip tone="amber">receipt optional</Chip> : null}
              {c?.warnAboveSen ? <Chip>guide RM {fmt(c.warnAboveSen)}</Chip> : null}
              {c && !c.active ? <Chip>inactive</Chip> : null}
            </summary>
            <form action={saveCategoryAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              {c ? <input type="hidden" name="id" value={c.id} /> : null}
              <div><label className="label">Name</label><input name="name" defaultValue={c?.name} className={i} required /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">GL account code</label><input name="glAccountCode" defaultValue={c?.glAccountCode ?? ""} className={i} placeholder="e.g. 9xx-000" /></div>
                <div><label className="label">GL account name</label><input name="glAccountName" defaultValue={c?.glAccountName ?? ""} className={i} /></div>
              </div>
              <div className="space-y-1">
                {box("requiresReceipt", "Receipt / invoice required", c?.requiresReceipt ?? true)}
                {box("requiresPurpose", "Business purpose required", c?.requiresPurpose ?? true)}
                {box("requiresLocation", "Location / route required", c?.requiresLocation ?? false)}
                {box("einvoiceApplicable", "e-Invoice fields apply (from effective date)", c?.einvoiceApplicable ?? true)}
                {box("specialApproval", "Special approval category (highlighted for Director)", c?.specialApproval ?? false)}
                {box("active", "Active (available to staff)", c?.active ?? true)}
              </div>
              <div className="space-y-2">
                <div><label className="label">Guide amount per expense (RM, optional warning)</label><input name="warnAbove" defaultValue={c?.warnAboveSen ? fmt(c.warnAboveSen).replace(/,/g, "") : ""} className={i} /></div>
                <div><label className="label">Display order</label><input name="sortOrder" defaultValue={c?.sortOrder ?? 99} className={i} /></div>
              </div>
              <div className="sm:col-span-2"><label className="label">Guidance shown to staff</label><input name="guidance" defaultValue={c?.guidance ?? ""} className={i} placeholder="e.g. Attach the parking ticket or e-receipt; state the location" /></div>
              <div className="sm:col-span-2"><label className="label">Finance verification checklist (one item per line)</label><textarea name="checklist" rows={5} defaultValue={((c?.checklist as string[]) ?? []).join("\n")} className={i} /></div>
              <button className="btn-primary btn-sm sm:w-40">Save</button>
            </form>
          </details>
        ))}
      </div>
    </AppShell>
  );
}
