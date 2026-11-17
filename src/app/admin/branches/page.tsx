import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle } from "@/components/ui";
import { Flash } from "@/components/flash";
import { saveBranchAction, saveCompanyAction } from "@/app/actions/admin";

export default async function Branches({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN");
  const [companies, branches] = await Promise.all([prisma.company.findMany({ orderBy: { name: "asc" } }), prisma.branch.findMany({ include: { company: true }, orderBy: { sortOrder: "asc" } })]);
  const i = "input !py-1.5 !text-sm";
  return (
    <AppShell user={u}>
      <PageTitle title="Companies & branches" sub="A claim belongs to one company. Lines charged to branches of another company are split into a separate claim automatically." />
      <Flash sp={await searchParams} />
      <h2 className="mb-2 font-bold">Companies</h2>
      <div className="space-y-2">
        {[...companies, null].map((c) => (
          <details key={c?.id ?? "new"} className="card p-3" open={!c && companies.length === 0}>
            <summary className="cursor-pointer font-semibold">{c ? `${c.code} · ${c.name}${c.isHolding ? " (holding)" : ""}` : "+ Add company"}</summary>
            <form action={saveCompanyAction} className="mt-3 grid gap-2 sm:grid-cols-3">
              {c ? <input type="hidden" name="id" value={c.id} /> : null}
              <input name="code" defaultValue={c?.code} placeholder="Code" className={i} required />
              <input name="name" defaultValue={c?.name} placeholder="Company name" className={`${i} sm:col-span-2`} required />
              <input name="brn" defaultValue={c?.brn ?? ""} placeholder="BRN" className={i} />
              <input name="tin" defaultValue={c?.tin ?? ""} placeholder="TIN" className={i} />
              <input name="sstNo" defaultValue={c?.sstNo ?? ""} placeholder="SST No." className={i} />
              <input name="address" defaultValue={c?.address ?? ""} placeholder="Address" className={`${i} sm:col-span-3`} />
              <input name="email" defaultValue={c?.email ?? ""} placeholder="Email" className={i} />
              <input name="phone" defaultValue={c?.phone ?? ""} placeholder="Phone" className={i} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isHolding" defaultChecked={c?.isHolding} />Holding company</label>
              <button className="btn-primary btn-sm sm:col-span-3 sm:w-40">Save company</button>
            </form>
          </details>
        ))}
      </div>
      <h2 className="mb-2 mt-6 font-bold">Branches</h2>
      <div className="card divide-y divide-gray-100">
        {[...branches, null].map((b) => (
          <form key={b?.id ?? "new"} action={saveBranchAction} className="grid items-center gap-2 p-3 sm:grid-cols-12">
            {b ? <input type="hidden" name="id" value={b.id} /> : null}
            <input name="code" defaultValue={b?.code} placeholder="Code" className={`${i} sm:col-span-2`} required />
            <input name="name" defaultValue={b?.name} placeholder={b ? "" : "New branch name"} className={`${i} sm:col-span-4`} required />
            <select name="companyId" defaultValue={b?.companyId} className={`${i} sm:col-span-3`} required>{companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select>
            <input name="sortOrder" defaultValue={b?.sortOrder ?? 99} className={`${i} sm:col-span-1`} aria-label="Order" />
            <label className="flex items-center gap-1 text-xs sm:col-span-1"><input type="checkbox" name="active" defaultChecked={b ? b.active : true} />Active</label>
            <button className="btn-ghost btn-sm sm:col-span-1">{b ? "Save" : "Add"}</button>
          </form>
        ))}
      </div>
    </AppShell>
  );
}
