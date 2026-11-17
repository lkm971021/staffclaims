/**
 * Create (or reset) the first administrator account.
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="FULL NAME" ADMIN_EMPLOYEE_NO=00001 ADMIN_PASSWORD='a-long-password' \
 *   ADMIN_ROLES=ADMIN,FINANCE,STAFF npm run create-admin
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
(async () => {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = (process.env.ADMIN_NAME ?? "").trim().toUpperCase();
  const employeeNo = (process.env.ADMIN_EMPLOYEE_NO ?? "").trim();
  const roles = (process.env.ADMIN_ROLES ?? "ADMIN").split(",").map((r) => r.trim()) as Role[];
  if (!email || !name || !employeeNo) throw new Error("Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_EMPLOYEE_NO.");
  if (password && password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters (or omit it to use Google sign-in only).");
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  const u = await prisma.user.upsert({
    where: { email },
    update: { roles, active: true, ...(passwordHash ? { passwordHash, failedLogins: 0, lockedUntil: null } : {}) },
    create: { email, name, employeeNo, roles, passwordHash },
  });
  await prisma.auditLog.create({ data: { entity: "User", entityId: u.id, action: "BOOTSTRAP_ADMIN", actorName: "create-admin script", after: { email, roles } } });
  console.log(`Admin ready: ${u.email} (${u.roles.join(", ")})`);
})()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
