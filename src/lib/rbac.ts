import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Claim, Role, User, Branch } from "@prisma/client";
import { authOptions } from "./auth";
import { prisma } from "./db";

export type SessionUser = User & { branch: Branch | null };

/** Loads the signed-in user fresh from the database on every request, so deactivation and
 *  role changes take effect immediately (not only when the session token expires). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const uid = (session as unknown as { uid?: string } | null)?.uid;
  if (!uid) return null;
  const user = await prisma.user.findUnique({ where: { id: uid }, include: { branch: true } });
  if (!user || !user.active) return null;
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!roles.some((r) => u.roles.includes(r))) redirect("/forbidden");
  return u;
}

export function hasRole(u: Pick<User, "roles">, r: Role) {
  return u.roles.includes(r);
}

/** Members this user may submit claims on behalf of (admin-configured delegation). */
export async function delegatedMemberIds(userId: string): Promise<string[]> {
  const rows = await prisma.teamDelegation.findMany({ where: { leaderId: userId, active: true, member: { active: true } } });
  return rows.map((r) => r.memberId);
}

export async function canSubmitFor(actorId: string, claimantId: string): Promise<boolean> {
  if (actorId === claimantId) return true;
  return (await delegatedMemberIds(actorId)).includes(claimantId);
}

/** Directors only see claims once Finance has verified them. */
const DIRECTOR_VISIBLE = new Set(["PENDING_DIRECTOR", "CLARIFICATION", "APPROVED_FOR_PAYMENT", "PAID", "REJECTED"]);

/** Central claim-visibility rule. Every claim/document read goes through this. */
export async function canViewClaim(u: SessionUser, claim: Pick<Claim, "claimantId" | "submittedById" | "status" | "financeVerifiedAt">) {
  if (claim.claimantId === u.id) return true;
  if (hasRole(u, "FINANCE")) return true;
  if (hasRole(u, "DIRECTOR") && DIRECTOR_VISIBLE.has(claim.status) && claim.financeVerifiedAt) return true;
  // team leader: only claims of assigned members
  const members = await delegatedMemberIds(u.id);
  return members.includes(claim.claimantId);
}

export async function canEditClaim(u: SessionUser, claim: Pick<Claim, "claimantId" | "status">) {
  if (claim.status !== "DRAFT" && claim.status !== "RETURNED") return false;
  return canSubmitFor(u.id, claim.claimantId);
}

/** Landing page by role. */
export function homeFor(u: Pick<User, "roles">) {
  if (u.roles.includes("FINANCE")) return "/finance";
  if (u.roles.includes("DIRECTOR")) return "/director";
  if (u.roles.includes("ADMIN") && !u.roles.includes("STAFF")) return "/admin";
  return "/staff";
}
