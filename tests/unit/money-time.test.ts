import { describe, expect, it } from "vitest";
import { fmt, parseToSen, rm } from "@/lib/money";
import { expensePeriodLabel, submissionDeadline, paymentTargetDate, driveMonthFolder, nowMY, todayMY } from "@/lib/time";

describe("money", () => {
  it("parses common inputs to sen without float error", () => {
    expect(parseToSen("85")).toBe(8500);
    expect(parseToSen("85.5")).toBe(8550);
    expect(parseToSen("RM 1,234.56")).toBe(123456);
    expect(parseToSen("0.10")).toBe(10);
    expect(parseToSen("19.99")).toBe(1999);
    expect(parseToSen("1.005")).toBeNull();
    expect(parseToSen("abc")).toBeNull();
    expect(parseToSen("")).toBeNull();
  });
  it("formats", () => {
    expect(fmt(61560)).toBe("615.60");
    expect(rm(123456)).toBe("RM 1,234.56");
    expect(fmt(-500)).toBe("(5.00)");
  });
});

describe("Malaysia dates & company deadlines", () => {
  it("June 2026 claims: submit by 5 July, pay by 16 July (SOP example)", () => {
    const d = submissionDeadline(2026, 6, 5);
    expect(d.toISOString()).toBe("2026-07-05T15:59:59.000Z"); // 23:59:59 MYT
    expect(paymentTargetDate(2026, 6, 16).toISOString()).toBe("2026-07-15T16:00:00.000Z"); // 00:00 MYT 16 July
  });
  it("December rolls into January", () => {
    expect(submissionDeadline(2026, 12, 5).toISOString().slice(0, 10)).toBe("2027-01-05");
  });
  it("expense period is computed (no '31 June')", () => {
    expect(expensePeriodLabel(2026, 6)).toBe("1 June 2026 - 30 June 2026");
    expect(expensePeriodLabel(2028, 2)).toBe("1 February 2028 - 29 February 2028");
  });
  it("Drive month folders follow existing naming", () => {
    expect(driveMonthFolder(11)).toBe("11. NOV");
    expect(driveMonthFolder(6)).toBe("6. JUNE");
  });
  it("uses Malaysia time, not server time", () => {
    // 2026-06-30 17:00 UTC is already 1 July 01:00 in Kuala Lumpur
    const t = new Date("2026-06-30T17:00:00Z");
    expect(nowMY(t)).toEqual({ year: 2026, month: 7, day: 1 });
    expect(todayMY(t)).toBe("2026-07-01");
  });
});
