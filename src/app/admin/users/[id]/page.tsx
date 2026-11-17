import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle } from "@/components/ui";
import { Flash } from "@/components/flash";
import { UserForm } from "@/components/user-form";
import { setDelegationAction } from "@/app/actions/admin";

export default async function EditUser({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN");
  const { id } = await params;
  const [user, branches, members, others] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    prisma.branch.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.teamDelegation.findMany({ where: { leaderId: id, active: true }, include: { member: true } }),
    prisma.user.findMany({ where: { active: true, id: { not: id }, roles: { has: "STAFF" } }, orderBy: { name: "asc" } }),
  ]);
  if (!user) notFound();
  return (
    <AppShell user={u}>
      <Link href="/admin/users" className="text-sm text-gray-500">← Users</Link>
      <PageTitle title={user.name} sub={`${user.employeeNo} · ${user.email}`} />
      <Flash sp={await searchParams} />
      <UserForm user={user} branches={branches} />
      <div className="card mt-4 space-y-3 p-4">
        <div className="font-semibold">Team leader: may submit claims on behalf of</div>
        <ul className="space-y-1 text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2">{m.member.name}
              <form action={setDelegationAction}><input type="hidden" name="leaderId" value={id} /><input type="hidden" name="memberId" value={m.memberId} /><input type="hidden" name="on" value="0" /><button className="text-xs text-red-700 underline">remove</button></form>
            </li>
          ))}
          {members.length === 0 ? <li className="text-gray-500">No team members assigned.</li> : null}
        </ul>
        <form action={setDelegationAction} className="flex gap-2">
          <input type="hidden" name="leaderId" value={id} /><input type="hidden" name="on" value="1" />
          <select name="memberId" className="input" required><option value="">Choose staff…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.employeeNo} {o.name}</option>)}</select>
          <button className="btn-ghost">Assign</button>
        </form>
        <div className="text-xs text-gray-500">The team member remains the claimant; the leader is recorded as the submitter. Leaders cannot see other staff&apos;s claims.</div>
      </div>
    </AppShell>
  );
}
