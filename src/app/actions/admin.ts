"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole, type SessionUser } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { setSetting, getSettings, type AppSettings } from "@/lib/settings";
import { parseToSen } from "@/lib/money";
import { enqueue } from "@/lib/jobs";

const back = (path: string, msg: string, ok = true) => redirect(`${path}?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const actor = (u: SessionUser) => ({ id: u.id, name: u.name });

// ------------------------------------------------------------------ users
const UserSchema = z.object({
  employeeNo: z.string().min(1, "Employee ID is required").max(20),
  name: z.string().min(2, "Full name is required").max(150),
  nickName: z.string().max(60).optional(),
  email: z.string().email("Valid email required").transform((s) => s.toLowerCase()),
  phone: z.string().max(30).optional(),
  nric: z.string().max(20).optional(),
  tin: z.string().max(30).optional(),
  department: z.string().max(80).optional(),
  position: z.string().max(80).optional(),
  branchId: z.string().optional(),
});

export async function saveUserAction(fd: FormData) {
  const u = await requireRole("ADMIN");
  const id = str(fd, "id");
  const p = UserSchema.safeParse(Object.fromEntries(["employeeNo", "name", "nickName", "email", "phone", "nric", "tin", "department", "position", "branchId"].map((k) => [k, str(fd, k) || undefined])));
  if (!p.success) back(id ? `/admin/users/${id}` : "/admin/users/new", p.error.issues.map((i) => i.message).join("; "), false);
  const v = p.data!;
  const roles = (["STAFF", "FINANCE", "DIRECTOR", "ADMIN"] as Role[]).filter((r) => fd.get(`role_${r}`) === "on");
  if (!roles.length) back(id ? `/admin/users/${id}` : "/admin/users/new", "Choose at least one role.", false);
  const password = str(fd, "password");
  if (password && password.length < 10) back(id ? `/admin/users/${id}` : "/admin/users/new", "Password must be at least 10 characters.", false);
  const data = {
    employeeNo: v.employeeNo, name: v.name.toUpperCase(), nickName: v.nickName || null, email: v.email, phone: v.phone || null, nric: v.nric || null, tin: v.tin || null,
    department: v.department || null, position: v.position || null, branchId: v.branchId || null, roles, active: fd.get("active") === "on" || !id,
    ...(password ? { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: fd.get("mustChange") === "on", failedLogins: 0, lockedUntil: null } : {}),
  };
  if (id && id === u.id && !roles.includes("ADMIN")) back(`/admin/users/${id}`, "You cannot remove your own Admin role.", false);
  if (id && id === u.id && fd.get("active") !== "on") back(`/admin/users/${id}`, "You cannot deactivate your own account.", false);
  let savedId = id;
  try {
    if (id) {
      const before = await prisma.user.findUniqueOrThrow({ where: { id } });
      await prisma.user.update({ where: { id }, data });
      const { passwordHash: _a, ...b } = before;
      void _a;
      await audit(prisma, actor(u), "User", id, "UPDATE_USER", b, { ...data, passwordHash: password ? "(changed)" : undefined });
    } else {
      const created = await prisma.user.create({ data });
      savedId = created.id;
      await audit(prisma, actor(u), "User", created.id, "CREATE_USER", undefined, { ...data, passwordHash: password ? "(set)" : undefined });
    }
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002" ? "Employee ID or email already exists." : "Could not save user.";
    back(id ? `/admin/users/${id}` : "/admin/users/new", msg, false);
  }
  revalidatePath("/admin/users");
  back(`/admin/users/${savedId}`, "Saved.");
}

export async function setDelegationAction(fd: FormData) {
  const u = await requireRole("ADMIN");
  const leaderId = str(fd, "leaderId");
  const memberId = str(fd, "memberId");
  const on = str(fd, "on") === "1";
  if (!leaderId || !memberId || leaderId === memberId) back(`/admin/users/${leaderId}`, "Choose a different team member.", false);
  await prisma.teamDelegation.upsert({ where: { leaderId_memberId: { leaderId, memberId } }, update: { active: on }, create: { leaderId, memberId, active: on } });
  await audit(prisma, actor(u), "TeamDelegation", `${leaderId}:${memberId}`, on ? "GRANT_SUBMIT_ON_BEHALF" : "REVOKE_SUBMIT_ON_BEHALF");
  back(`/admin/users/${leaderId}`, on ? "Team member assigned." : "Team member removed.");
}

// ------------------------------------------------------------------ branches & companies
export async function saveBranchAction(fd: FormData) {
  const u = await requireRole("ADMIN");
  const id = str(fd, "id");
  const data = { code: str(fd, "code").toUpperCase(), name: str(fd, "name").toUpperCase(), companyId: str(fd, "companyId"), active: fd.get("active") === "on", sortOrder: Number(str(fd, "sortOrder")) || 0 };
  if (!data.code || !data.name || !data.companyId) back("/admin/branches", "Code, name and company are required.", false);
  try {
    if (id) await prisma.branch.update({ where: { id }, data });
    else await prisma.branch.create({ data });
  } catch {
    back("/admin/branches", "Branch code or name already exists.", false);
  }
  await audit(prisma, actor(u), "Branch", id || data.code, id ? "UPDATE_BRANCH" : "CREATE_BRANCH", undefined, data);
  back("/admin/branches", "Saved.");
}

export async function saveCompanyAction(fd: FormData) {
  const u = await requireRole("ADMIN");
  const id = str(fd, "id");
  const data = {
    code: str(fd, "code").toUpperCase(), name: str(fd, "name").toUpperCase(), brn: str(fd, "brn") || null, tin: str(fd, "tin") || null, sstNo: str(fd, "sstNo") || null,
    address: str(fd, "address") || null, email: str(fd, "email") || null, phone: str(fd, "phone") || null, isHolding: fd.get("isHolding") === "on",
  };
  if (!data.code || !data.name) back("/admin/branches", "Company code and name are required.", false);
  if (id) await prisma.company.update({ where: { id }, data });
  else await prisma.company.create({ data });
  await audit(prisma, actor(u), "Company", id || data.code, id ? "UPDATE_COMPANY" : "CREATE_COMPANY", undefined, data);
  back("/admin/branches", "Saved.");
}

export async function setCompanyDriveRootAction(fd: FormData) {
  const u = await requireRole("ADMIN");
  const id = str(fd, "id");
  const folder = str(fd, "driveRootId").replace(/^.*folders\//, "").replace(/[?#].*$/, "");
  await prisma.company.update({ where: { id }, data: { driveRootId: folder || null } });
  await audit(prisma, actor(u), "Company", id, "SET_DRIVE_ROOT", undefined, { driveRootId: folder });
  back("/admin/google", folder ? "Drive folder saved. It must be a folder created by this app (drive.file access)." : "Cleared — the app will create a new root folder.");
}

// ------------------------------------------------------------------ categories (Finance or Admin)
export async function saveCategoryAction(fd: FormData) {
  const u = await requireRole("FINANCE", "ADMIN");
  const id = str(fd, "id");
  const warn = str(fd, "warnAbove");
  const data = {
    name: str(fd, "name").toUpperCase(),
    glAccountCode: str(fd, "glAccountCode") || null,
    glAccountName: str(fd, "glAccountName") || null,
    requiresReceipt: fd.get("requiresReceipt") === "on",
    requiresLocation: fd.get("requiresLocation") === "on",
    requiresPurpose: fd.get("requiresPurpose") === "on",
    einvoiceApplicable: fd.get("einvoiceApplicable") === "on",
    specialApproval: fd.get("specialApproval") === "on",
    warnAboveSen: warn ? parseToSen(warn) : null,
    checklist: str(fd, "checklist").split("\n").map((s) => s.trim()).filter(Boolean),
    guidance: str(fd, "guidance") || null,
    active: fd.get("active") === "on",
    sortOrder: Number(str(fd, "sortOrder")) || 0,
  };
  if (!data.name) back("/admin/categories", "Name is required.", false);
  try {
    const before = id ? await prisma.expenseCategory.findUnique({ where: { id } }) : null;
    if (id) await prisma.expenseCategory.update({ where: { id }, data });
    else await prisma.expenseCategory.create({ data });
    await audit(prisma, actor(u), "ExpenseCategory", id || data.name, id ? "UPDATE_CATEGORY" : "CREATE_CATEGORY", before, data);
  } catch {
    back("/admin/categories", "A category with this name already exists.", false);
  }
  revalidatePath("/admin/categories");
  back("/admin/categories", `Saved ${data.name}.`);
}

// ------------------------------------------------------------------ settings
export async function saveSettingsAction(fd: FormData) {
  const u = await requireRole("ADMIN");
  const s = await getSettings();
  const num = (k: string, min: number, max: number) => {
    const n = Number(str(fd, k));
    if (!Number.isInteger(n) || n < min || n > max) back("/admin/settings", `${k} must be between ${min} and ${max}.`, false);
    return n;
  };
  const date = str(fd, "einvoiceEffectiveDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back("/admin/settings", "Invalid e-Invoice effective date.", false);
  const modes = ["required", "optional", "hidden"];
  const einv = Object.fromEntries(Object.keys(s.einvoiceFields).map((k) => [k, modes.includes(str(fd, `einv_${k}`)) ? str(fd, `einv_${k}`) : "optional"]));
  const next: Partial<AppSettings> = {
    submissionDeadlineDay: num("submissionDeadlineDay", 1, 28),
    paymentTargetDay: num("paymentTargetDay", 1, 28),
    reminderDaysBeforeDeadline: str(fd, "reminderDays").split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 31),
    directorOverdueDays: num("directorOverdueDays", 1, 30),
    einvoiceEffectiveDate: date,
    einvoiceFields: einv as AppSettings["einvoiceFields"],
    reimbursementMethods: str(fd, "reimbursementMethods").split("\n").map((x) => x.trim()).filter(Boolean),
    hardcopyRequired: fd.get("hardcopyRequired") === "on",
    retentionYears: num("retentionYears", 1, 30),
    financialYearEndMonth: num("financialYearEndMonth", 1, 12),
    ocrEnabled: fd.get("ocrEnabled") === "on",
    formNotes: str(fd, "formNotes").split("\n").map((x) => x.trim()).filter(Boolean),
    maxUploadMb: num("maxUploadMb", 1, 30),
    driveRootFolderName: str(fd, "driveRootFolderName") || s.driveRootFolderName,
  };
  for (const [k, v] of Object.entries(next)) {
    const before = (s as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(before) !== JSON.stringify(v)) {
      await setSetting(k as keyof AppSettings, v, u.name);
      await audit(prisma, actor(u), "Setting", k, "UPDATE_SETTING", before, v);
    }
  }
  revalidatePath("/admin/settings");
  back("/admin/settings", "Settings saved.");
}

// ------------------------------------------------------------------ jobs
export async function retryJobAction(fd: FormData) {
  const u = await requireRole("ADMIN", "FINANCE");
  const id = str(fd, "id");
  await prisma.syncJob.update({ where: { id }, data: { status: "QUEUED", attempts: 0, runAfter: new Date(), lastError: null } });
  await audit(prisma, actor(u), "SyncJob", id, "RETRY_JOB");
  back("/admin/jobs", "Job re-queued.");
}

export async function resyncAllAction() {
  const u = await requireRole("ADMIN");
  const claims = await prisma.claim.findMany({ where: { status: { not: "DRAFT" } }, select: { id: true } });
  for (const c of claims) {
    await enqueue(prisma, "ARCHIVE_CLAIM", { claimId: c.id }, `archive:${c.id}`);
    await enqueue(prisma, "SHEETS_SYNC_CLAIM", { claimId: c.id }, `sheet:${c.id}`, 5000);
  }
  await audit(prisma, actor(u), "System", "sync", "RESYNC_ALL", undefined, { claims: claims.length });
  back("/admin/google", `Queued ${claims.length} claims for Drive archive and Sheet sync.`);
}

export async function backupNowAction() {
  const u = await requireRole("ADMIN");
  const { runDailyBackup } = await import("@/lib/backup");
  let msg = "";
  try {
    const r = await runDailyBackup(true);
    msg = "file" in r ? `Backup saved to Google Drive: ${r.file}` : `Backup skipped: ${r.skipped}`;
    await audit(prisma, actor(u), "System", "backup", "BACKUP_NOW", undefined, r);
  } catch (e) {
    back("/admin/google", `Backup failed: ${(e as Error).message}`, false);
  }
  back("/admin/google", msg, !msg.startsWith("Backup skipped"));
}

export async function disconnectGoogleAction() {
  const u = await requireRole("ADMIN");
  await prisma.googleCredential.deleteMany({});
  await audit(prisma, actor(u), "GoogleCredential", "default", "DISCONNECT");
  back("/admin/google", "Google disconnected. The app is now in MOCK mode.");
}
