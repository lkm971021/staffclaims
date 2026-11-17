import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Chip } from "@/components/ui";
import { Flash } from "@/components/flash";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Users" };

export default async function Users({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN");
  const sp = await searchParams;
  const q = sp.q?.trim();
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { employeeNo: { contains: q } }] } : {},
    include: { branch: true, leads: { where: { active: true } } },
    orderBy: [{ active: "desc" }, { employeeNo: "asc" }],
  });
  return (
    <AppShell user={u}>
      <PageTitle title="Users & access" actions={<Link href="/admin/users/new" className="btn-primary btn-sm">+ Add user</Link>} />
      <Flash sp={sp} />
      <form className="mb-3"><input name="q" defaultValue={q} placeholder="Search name, email or employee ID" className="input" /></form>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">ID</th><th className="th">Name</th><th className="th">Email</th><th className="th">Branch</th><th className="th">Roles</th><th className="th">Last login</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((x) => (
              <tr key={x.id} className={x.active ? "" : "opacity-50"}>
                <td className="td">{x.employeeNo}</td>
                <td className="td font-medium">{x.name}{x.isDemo ? <Chip tone="violet">demo</Chip> : null}{!x.active ? <Chip>inactive</Chip> : null}</td>
                <td className="td">{x.email}</td>
                <td className="td">{x.branch?.name}</td>
                <td className="td">{x.roles.map((r) => <Chip key={r} tone={r === "STAFF" ? "gray" : "blue"}>{r}</Chip>)}{x.leads.length ? <Chip tone="teal">leads {x.leads.length}</Chip> : null}</td>
                <td className="td text-gray-500">{fmtDateTime(x.lastLoginAt)}</td>
                <td className="td"><Link href={`/admin/users/${x.id}`} className="text-blue-700 underline">Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
