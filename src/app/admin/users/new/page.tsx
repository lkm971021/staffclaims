import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle } from "@/components/ui";
import { Flash } from "@/components/flash";
import { UserForm } from "@/components/user-form";

export default async function NewUser({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN");
  const branches = await prisma.branch.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return (
    <AppShell user={u}>
      <PageTitle title="Add user" sub="Staff sign in with Google using this email, or with the password you set." />
      <Flash sp={await searchParams} />
      <UserForm branches={branches} />
    </AppShell>
  );
}
