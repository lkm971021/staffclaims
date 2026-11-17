/** Money helpers. All amounts are integer sen to avoid floating-point errors. */

/** Parse user input like "1,234.5", "RM 12", "12.30" into sen. Returns null if invalid. */
export function parseToSen(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/rm|myr|,|\s/gi, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const sen = parseInt(whole, 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
  return neg ? -sen : sen;
}

/** 123456 -> "1,234.56" */
export function fmt(sen: number | null | undefined): string {
  if (sen === null || sen === undefined) return "-";
  const neg = sen < 0;
  const abs = Math.abs(sen);
  const whole = Math.floor(abs / 100).toLocaleString("en-MY");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "(" : ""}${whole}.${frac}${neg ? ")" : ""}`;
}

/** 123456 -> "RM 1,234.56" */
export function rm(sen: number | null | undefined): string {
  return sen === null || sen === undefined ? "-" : `RM ${fmt(sen)}`;
}

/** sen -> decimal number for spreadsheets (exact for 2dp). */
export function toDecimal(sen: number | null | undefined): number | null {
  return sen === null || sen === undefined ? null : Math.round(sen) / 100;
}

export function sum(values: (number | null | undefined)[]): number {
  return values.reduce<number>((a, v) => a + (v ?? 0), 0);
}
