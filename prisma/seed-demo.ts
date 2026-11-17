/**
 * DEMO / TEST accounts only. Every user created here has isDemo = true, an @example.test email
 * and a name starting with "DEMO". Demo users and their claims are excluded from real reports.
 * Never run this in production unless you intend to test; remove with `npm run db:purge-demo`.
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PASSWORD = process.env.DEMO_PASSWORD || "Demo-Claims-2026!";

const USERS: { employeeNo: string; name: string; email: string; branch: string; roles: Role[]; dept: string; pos: string }[] = [
  { employeeNo: "D0001", name: "DEMO STAFF ALICE", email: "alice@example.test", branch: "MIDTOWN", roles: ["STAFF"], dept: "Physiotherapy", pos: "Physiotherapist" },
  { employeeNo: "D0002", name: "DEMO STAFF BEN", email: "ben@example.test", branch: "JBSUTERA", roles: ["STAFF"], dept: "Physiotherapy", pos: "Physiotherapist" },
  { employeeNo: "D0003", name: "DEMO LEADER CHLOE", email: "chloe@example.test", branch: "UPTOWN", roles: ["STAFF"], dept: "Pilates", pos: "Team Leader" },
  { employeeNo: "D0004", name: "DEMO JUNIOR DAN", email: "dan@example.test", branch: "UPTOWN", roles: ["STAFF"], dept: "Pilates", pos: "Junior Instructor" },
  { employeeNo: "D0090", name: "DEMO FINANCE FIONA", email: "finance@example.test", branch: "ALL", roles: ["STAFF", "FINANCE"], dept: "Finance", pos: "Finance & Accounting Manager" },
  { employeeNo: "D0091", name: "DEMO DIRECTOR DAVID", email: "director@example.test", branch: "ALL", roles: ["STAFF", "DIRECTOR"], dept: "Management", pos: "Service Director" },
  { employeeNo: "D0099", name: "DEMO ADMIN ADAM", email: "admin@example.test", branch: "ALL", roles: ["ADMIN"], dept: "Admin", pos: "System Administrator" },
];

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12);
  const branches = await prisma.branch.findMany();
  for (const u of USERS) {
    const branchId = branches.find((b) => b.code === u.branch)?.id;
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        employeeNo: u.employeeNo, name: u.name, email: u.email, branchId, roles: u.roles,
        department: u.dept, position: u.pos, passwordHash: hash, isDemo: true,
        nric: "000000-00-0000", tin: "IG00000000000",
      },
    });
  }
  const chloe = await prisma.user.findUniqueOrThrow({ where: { email: "chloe@example.test" } });
  const dan = await prisma.user.findUniqueOrThrow({ where: { email: "dan@example.test" } });
  await prisma.teamDelegation.upsert({
    where: { leaderId_memberId: { leaderId: chloe.id, memberId: dan.id } },
    update: {},
    create: { leaderId: chloe.id, memberId: dan.id },
  });
  console.log(`Demo users ready (password: ${PASSWORD}). Emails: ${USERS.map((u) => u.email).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
