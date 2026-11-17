import type { Prisma } from "@prisma/client";

/** Atomically allocate the next number for a key (row-locked upsert; safe under concurrency). */
async function next(tx: Prisma.TransactionClient, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "RefCounter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "RefCounter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

const mm = (m: number) => String(m).padStart(2, "0");

/** CLM-2026-11-0001 */
export async function nextClaimRef(tx: Prisma.TransactionClient, year: number, month: number) {
  const n = await next(tx, `CLM-${year}-${mm(month)}`);
  return `CLM-${year}-${mm(month)}-${String(n).padStart(4, "0")}`;
}

/** PAY-2026-11-001 */
export async function nextBatchRef(tx: Prisma.TransactionClient, year: number, month: number) {
  const n = await next(tx, `PAY-${year}-${mm(month)}`);
  return `PAY-${year}-${mm(month)}-${String(n).padStart(3, "0")}`;
}

/** Supplementary claim: CLM-2026-11-0001-S1 */
export async function nextSupplementaryRef(tx: Prisma.TransactionClient, parentRef: string) {
  const n = await next(tx, `SUP-${parentRef}`);
  return `${parentRef}-S${n}`;
}
