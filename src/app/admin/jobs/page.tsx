import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Chip } from "@/components/ui";
import { Flash } from "@/components/flash";
import { retryJobAction } from "@/app/actions/admin";
import { fmtDateTime } from "@/lib/time";

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN", "FINANCE");
  const sp = await searchParams;
  const status = sp.status as "QUEUED" | "RUNNING" | "DONE" | "FAILED" | undefined;
  const [jobs, counts] = await Promise.all([
    prisma.syncJob.findMany({ where: status ? { status } : { status: { not: "DONE" } }, orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.syncJob.groupBy({ by: ["status"], _count: true }),
  ]);
  return (
    <AppShell user={u} wide>
      <PageTitle title="Background jobs" sub={counts.map((c) => `${c.status}: ${c._count}`).join(" · ")} actions={
        <div className="flex gap-1">{["", "QUEUED", "FAILED", "DONE"].map((s) => <a key={s} href={`/admin/jobs${s ? `?status=${s}` : ""}`} className={`btn-sm ${status === s || (!status && !s) ? "btn-primary" : "btn-ghost"}`}>{s || "Open"}</a>)}</div>
      } />
      <Flash sp={sp} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">Kind</th><th className="th">Payload</th><th className="th">Status</th><th className="th">Attempts</th><th className="th">Next run</th><th className="th">Last error</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="td">{j.kind}</td>
                <td className="td text-xs">{JSON.stringify(j.payload)}</td>
                <td className="td"><Chip tone={j.status === "FAILED" ? "red" : j.status === "DONE" ? "green" : "blue"}>{j.status}</Chip></td>
                <td className="td">{j.attempts}/{j.maxAttempts}</td>
                <td className="td text-xs">{fmtDateTime(j.runAfter)}</td>
                <td className="td max-w-md truncate text-xs text-red-700" title={j.lastError ?? ""}>{j.lastError}</td>
                <td className="td">{j.status === "FAILED" || j.status === "QUEUED" ? <form action={retryJobAction}><input type="hidden" name="id" value={j.id} /><button className="btn-ghost btn-sm">Retry now</button></form> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
