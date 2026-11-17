import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { PageTitle } from "@/components/ui";
import { googleMode } from "@/lib/google/auth";

export const metadata = { title: "Admin" };

export default async function AdminHome() {
  const u = await requireRole("ADMIN");
  const [users, failed, mode] = await Promise.all([prisma.user.count({ where: { active: true } }), prisma.syncJob.count({ where: { status: "FAILED" } }), googleMode()]);
  const cards = [
    ["/admin/users", "Users & access", `${users} active accounts · roles, branches, team leaders`],
    ["/admin/branches", "Companies & branches", "Holding / subsidiary and branch list"],
    ["/admin/categories", "Expense categories & policy", "Required documents, checklists, GL codes, guide amounts"],
    ["/admin/settings", "Deadlines, payment dates & e-Invoice", "Submission day, payment day, e-Invoice fields & effective date"],
    ["/admin/google", "Google Drive & Sheets", mode === "live" ? "Connected (live)" : "Not connected — MOCK mode"],
    ["/admin/jobs", "Sync jobs", failed ? `${failed} failed — needs attention` : "Drive / Sheets / email queue"],
    ["/admin/audit", "Audit log", "Every change, approval, export and download"],
  ];
  return (
    <AppShell user={u}>
      <PageTitle title="Administration" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([href, t, s]) => (
          <Link key={href} href={href} className="card p-4 hover:border-gray-400"><div className="font-semibold">{t}</div><div className="text-sm text-gray-500">{s}</div></Link>
        ))}
      </div>
    </AppShell>
  );
}
