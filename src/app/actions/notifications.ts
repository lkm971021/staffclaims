"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";

export async function markRead(id: string, link: string | null) {
  const u = await requireUser();
  await prisma.notification.updateMany({ where: { id, userId: u.id }, data: { readAt: new Date() } });
  if (link && link.startsWith("/")) redirect(link);
  revalidatePath("/notifications");
}

export async function markAllRead() {
  const u = await requireUser();
  await prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}
