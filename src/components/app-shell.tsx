import Link from "next/link";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/rbac";
import { googleMode } from "@/lib/google/auth";
import { SignOutButton } from "./sign-out";
import { NavLink } from "./nav-link";

export async function AppShell({ user, children, wide }: { user: SessionUser; children: React.ReactNode; wide?: boolean }) {
  const [unread, mode] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    user.roles.some((r) => r === "FINANCE" || r === "ADMIN") ? googleMode() : Promise.resolve(null),
  ]);
  const links: { href: string; label: string }[] = [];
  if (user.roles.includes("STAFF")) links.push({ href: "/staff", label: "My Claims" });
  if (user.roles.includes("FINANCE"))
    links.push(
      { href: "/finance", label: "Finance" },
      { href: "/finance/claims", label: "Claim Register" },
      { href: "/finance/payments", label: "Payments" },
      { href: "/finance/reports", label: "Reports" },
      { href: "/admin/categories", label: "Policy" },
      { href: "/admin/audit", label: "Audit" },
    );
  if (user.roles.includes("DIRECTOR")) links.push({ href: "/director", label: "Approvals" });
  if (user.roles.includes("FINANCE") || user.roles.includes("DIRECTOR")) links.push({ href: "/management", label: "Overview" });
  if (user.roles.includes("ADMIN")) links.push({ href: "/admin", label: "Admin" });
  const seen = new Set<string>();
  for (let i = links.length - 1; i >= 0; i--) (seen.has(links[i].href) ? links.splice(i, 1) : seen.add(links[i].href));

  return (
    <div className="min-h-screen pb-20 sm:pb-0">
      {user.isDemo ? (
        <div className="bg-violet-700 px-4 py-1 text-center text-xs font-semibold text-white">DEMO ACCOUNT — test data only, never real financial records</div>
      ) : null}
      {mode === "mock" ? (
        <div className="bg-amber-500 px-4 py-1 text-center text-xs font-semibold text-white">
          MOCK MODE — Google Drive / Sheets not connected. Files are archived locally only. <Link className="underline" href="/admin/google">Connect Google</Link>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className={`mx-auto flex h-14 items-center gap-3 px-4 ${wide ? "max-w-[1600px]" : "max-w-6xl"}`}>
          <Link href="/" className="flex items-center gap-2 font-bold">
            <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-lg" />
            <span className="hidden sm:inline">Staff Claims</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-1 overflow-x-auto md:flex">
            {links.map((l) => (
              <NavLink key={l.href} href={l.href}>{l.label}</NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-gray-100" aria-label={`Notifications (${unread} unread)`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
              {unread ? <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
            <div className="hidden text-right text-xs leading-tight sm:block">
              <div className="font-semibold">{user.nickName || user.name}</div>
              <div className="text-gray-500">{user.roles.filter((r) => r !== "STAFF").join(" · ") || "Staff"}</div>
            </div>
            <SignOutButton />
          </div>
        </div>
        {links.length > 1 ? (
          <nav className="flex gap-1 overflow-x-auto border-t border-gray-100 px-2 py-1 md:hidden">
            {links.map((l) => (
              <NavLink key={l.href} href={l.href}>{l.label}</NavLink>
            ))}
          </nav>
        ) : null}
      </header>
      <main className={`mx-auto px-4 py-5 ${wide ? "max-w-[1600px]" : "max-w-6xl"}`}>{children}</main>
    </div>
  );
}
