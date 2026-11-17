import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN", "FINANCE");
  const sp = await searchParams;
  const q = sp.q?.trim();
  const rows = await prisma.auditLog.findMany({
    where: q ? { OR: [{ entityId: q }, { action: { contains: q, mode: "insensitive" } }, { actorName: { contains: q, mode: "insensitive" } }, { entity: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { at: "desc" },
    take: 300,
  });
  return (
    <AppShell user={u} wide>
      <PageTitle title="Audit log" sub="Append-only: records cannot be edited or deleted (enforced by the database)." />
      <form className="mb-3"><input name="q" defaultValue={q} className="input" placeholder="Filter by action, person, entity or record ID" /></form>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Record</th><th className="th">Details</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="td text-xs">{fmtDateTime(r.at)}</td>
                <td className="td text-xs">{r.actorName ?? "system"}</td>
                <td className="td text-xs font-semibold">{r.action}</td>
                <td className="td text-xs">{r.entity} <span className="text-gray-400">{r.entityId.slice(0, 14)}</span></td>
                <td className="td max-w-xl whitespace-normal text-xs text-gray-600">
                  {r.before ? <details><summary className="cursor-pointer">before / after</summary><pre className="overflow-x-auto whitespace-pre-wrap text-[10px]">{JSON.stringify({ before: r.before, after: r.after }, null, 1).slice(0, 3000)}</pre></details> : r.after ? <span>{JSON.stringify(r.after).slice(0, 200)}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
