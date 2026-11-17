import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./db";
import { enqueue } from "./jobs";

type Tx = Prisma.TransactionClient | typeof prisma;

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  claimId?: string;
  link?: string;
  /** If set, at most one notification per user per key (used for reminders). */
  dedupeKey?: string;
}

export async function usersWithRole(tx: Tx, role: Role) {
  return tx.user.findMany({ where: { roles: { has: role }, active: true }, select: { id: true } });
}

export async function notify(tx: Tx, userIds: string[], n: NotificationInput) {
  for (const userId of Array.from(new Set(userIds))) {
    const dedupeKey = n.dedupeKey ? `${n.dedupeKey}:${userId}` : undefined;
    if (dedupeKey && (await tx.notification.findUnique({ where: { dedupeKey } }))) continue;
    const row = await tx.notification.create({
      data: { userId, type: n.type, title: n.title, body: n.body, claimId: n.claimId, link: n.link, dedupeKey },
    });
    await enqueue(tx, "EMAIL", { notificationId: row.id });
  }
}

export async function notifyRole(tx: Tx, role: Role, n: NotificationInput, exceptUserId?: string) {
  const ids = (await usersWithRole(tx, role)).map((u) => u.id).filter((id) => id !== exceptUserId);
  await notify(tx, ids, n);
}
