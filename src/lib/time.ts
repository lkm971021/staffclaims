/** Malaysia time helpers. Server stores UTC; business rules use Asia/Kuala_Lumpur (UTC+8, no DST). */
export const TZ = "Asia/Kuala_Lumpur";
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

export const MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV", "DEC"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Current Y/M/D in Malaysia. */
export function nowMY(now = new Date()) {
  const d = new Date(now.getTime() + MYT_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Malaysian local midnight of a given date, as a UTC Date. */
export function myMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - MYT_OFFSET_MS);
}

/** "@db.Date" fields come back as UTC midnight; build them from Y-M-D strings. */
export function dateOnly(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Invalid date ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function ymdOf(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

/** Today's date in Malaysia as YYYY-MM-DD. */
export function todayMY(now = new Date()): string {
  const { year, month, day } = nowMY(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function nextMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function prevMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Submission deadline: end of `deadlineDay` (23:59:59 MYT) of the following month. */
export function submissionDeadline(year: number, month: number, deadlineDay: number): Date {
  const n = nextMonth(year, month);
  const day = Math.min(deadlineDay, daysInMonth(n.year, n.month));
  return new Date(myMidnight(n.year, n.month, day).getTime() + 24 * 3600 * 1000 - 1000);
}

export function paymentTargetDate(year: number, month: number, paymentDay: number): Date {
  const n = nextMonth(year, month);
  return myMidnight(n.year, n.month, Math.min(paymentDay, daysInMonth(n.year, n.month)));
}

export function monthLabel(year: number, month: number) {
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** Template-style "1 June 2026 - 30 June 2026" (computed, so never "31 June"). */
export function expensePeriodLabel(year: number, month: number) {
  return `1 ${MONTHS_LONG[month - 1]} ${year} - ${daysInMonth(year, month)} ${MONTHS_LONG[month - 1]} ${year}`;
}

/** Existing Drive naming: "11. NOV" */
export function driveMonthFolder(month: number) {
  return `${month}. ${MONTHS_SHORT[month - 1]}`;
}

const dtf = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dtfTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** dd/mm/yyyy in Malaysia time (template format). For @db.Date values pass dateOnly=true. */
export function fmtDate(d: Date | null | undefined, isDateOnly = false): string {
  if (!d) return "";
  if (isDateOnly) {
    const s = d.toISOString().slice(0, 10).split("-");
    return `${s[2]}/${s[1]}/${s[0]}`;
  }
  return dtf.format(d);
}

export function fmtDateTime(d: Date | null | undefined): string {
  return d ? dtfTime.format(d) : "";
}
