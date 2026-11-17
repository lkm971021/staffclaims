import { prisma } from "./db";
import { notify, notifyRole } from "./notify";
import { getSettings } from "./settings";
import { monthLabel, nowMY, paymentTargetDate, prevMonth, submissionDeadline, fmtDate } from "./time";

const DAY = 24 * 3600 * 1000;

/**
 * Hourly reminder sweep. Each reminder has a dedupe key so it is sent at most once per person per period.
 * Reminders are in-app (and email if SMTP is configured). WhatsApp stays manual - see the copy templates on the Finance dashboard.
 */
export async function runReminders(now = new Date()) {
  const s = await getSettings();
  const { year, month } = nowMY(now);
  const prev = prevMonth(year, month);
  const deadline = submissionDeadline(prev.year, prev.month, s.submissionDeadlineDay);
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / DAY);
  const label = monthLabel(prev.year, prev.month);

  // 1. Deadline approaching (staff) - for last month's claims
  if (daysLeft >= 0 && s.reminderDaysBeforeDeadline.includes(daysLeft)) {
    const staff = await prisma.user.findMany({ where: { active: true, roles: { has: "STAFF" } }, select: { id: true } });
    await notify(prisma, staff.map((u) => u.id), {
      type: "DEADLINE",
      title: `${label} claims due ${fmtDate(deadline)}`,
      body: `Please submit all ${label} claims with supporting documents by ${fmtDate(deadline)}. Payment is targeted for ${fmtDate(paymentTargetDate(prev.year, prev.month, s.paymentTargetDay))}, subject to verification and approval.`,
      link: "/staff",
      dedupeKey: `deadline:${prev.year}-${prev.month}:${daysLeft}`,
    });
  }

  // 2. Drafts / returned claims not yet (re)submitted
  const open = await prisma.claim.findMany({
    where: { status: { in: ["DRAFT", "RETURNED"] }, lines: { some: {} }, updatedAt: { lt: new Date(now.getTime() - DAY) } },
    select: { id: true, ref: true, status: true, claimantId: true, claimYear: true, claimMonth: true },
  });
  for (const c of open) {
    await notify(prisma, [c.claimantId], {
      type: "DRAFT_REMINDER",
      title: c.status === "RETURNED" ? `${c.ref} still needs your correction` : `Draft ${c.ref} not yet submitted`,
      body: `Your ${monthLabel(c.claimYear, c.claimMonth)} claim is ${c.status === "RETURNED" ? "waiting for your correction" : "still a draft"}. Submit it before the deadline.`,
      claimId: c.id,
      link: `/staff/claims/${c.id}`,
      dedupeKey: `draft:${c.id}:${now.toISOString().slice(0, 10)}`,
    });
  }

  // 3. Finance: claims waiting > 2 days, open duplicates, approaching payment date
  const waiting = await prisma.claim.count({ where: { status: { in: ["PENDING_FINANCE", "CLARIFICATION"] }, submittedAt: { lt: new Date(now.getTime() - 2 * DAY) } } });
  if (waiting)
    await notifyRole(prisma, "FINANCE", {
      type: "FINANCE_BACKLOG", title: `${waiting} claim(s) awaiting verification for over 2 days`, body: "Open the verification queue.", link: "/finance/claims?queue=finance",
      dedupeKey: `finbacklog:${now.toISOString().slice(0, 10)}`,
    });
  const dups = await prisma.duplicateFlag.count({ where: { decision: "OPEN" } });
  if (dups)
    await notifyRole(prisma, "FINANCE", {
      type: "DUPLICATES", title: `${dups} possible duplicate receipt(s) to review`, body: "Decide each flag in the verification workspace.", link: "/finance/claims?queue=duplicates",
      dedupeKey: `dups:${now.toISOString().slice(0, 10)}`,
    });
  const payDate = paymentTargetDate(prev.year, prev.month, s.paymentTargetDay);
  const toPay = Math.ceil((payDate.getTime() - now.getTime()) / DAY);
  if (toPay >= 0 && toPay <= 3) {
    const outstanding = await prisma.claim.count({
      where: { claimYear: prev.year, claimMonth: prev.month, status: { in: ["PENDING_FINANCE", "CLARIFICATION", "PENDING_DIRECTOR", "APPROVED_FOR_PAYMENT"] } },
    });
    if (outstanding)
      await notifyRole(prisma, "FINANCE", {
        type: "PAYMENT_DATE", title: `${outstanding} ${label} claim(s) outstanding - payment target ${fmtDate(payDate)}`, body: "Review the Monthly Payment dashboard.", link: "/finance/payments",
        dedupeKey: `paydate:${prev.year}-${prev.month}:${toPay}`,
      });
  }

  // 4. Director: overdue approvals
  const overdue = await prisma.claim.count({
    where: { status: "PENDING_DIRECTOR", financeVerifiedAt: { lt: new Date(now.getTime() - s.directorOverdueDays * DAY) } },
  });
  if (overdue)
    await notifyRole(prisma, "DIRECTOR", {
      type: "DIRECTOR_OVERDUE", title: `${overdue} claim(s) waiting for your approval over ${s.directorOverdueDays} days`, body: "Open the approval queue.", link: "/director",
      dedupeKey: `dirover:${now.toISOString().slice(0, 10)}`,
    });
}
