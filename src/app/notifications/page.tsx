import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { markAllRead, markRead } from "@/app/actions/notifications";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const u = await requireUser();
  const items = await prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <AppShell user={u}>
      <PageTitle
        title="Notifications"
        sub={`${items.filter((i) => !i.readAt).length} unread`}
        actions={<form action={markAllRead}><button className="btn-ghost btn-sm">Mark all as read</button></form>}
      />
      {items.length === 0 ? <Empty>No notifications yet.</Empty> : null}
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id} className={`card flex items-start gap-3 p-4 ${n.readAt ? "opacity-70" : ""}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-gray-300" : "bg-blue-600"}`} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{n.title}</div>
              {n.body ? <div className="whitespace-pre-line text-sm text-gray-600">{n.body}</div> : null}
              <div className="mt-1 text-xs text-gray-400">{fmtDateTime(n.createdAt)}</div>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              {n.link ? (
                <form action={markRead.bind(null, n.id, n.link)}>
                  <button className="btn-ghost btn-sm">Open</button>
                </form>
              ) : null}
              {!n.readAt && !n.link ? (
                <form action={markRead.bind(null, n.id, null)}><button className="btn-ghost btn-sm">Read</button></form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-center text-xs text-gray-400"><Link href="/" className="underline">Back</Link></p>
    </AppShell>
  );
}
