import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | typeof prisma;

export type JobKind = "ARCHIVE_CLAIM" | "SHEETS_SYNC_CLAIM" | "SHEETS_SYNC_BATCH" | "EMAIL" | "OCR_DOCUMENT";

/**
 * Durable job queue stored in Postgres. Jobs are enqueued in the same transaction as the business
 * change, so a claim can never be saved without its Drive/Sheets work being queued.
 * With a dedupeKey, re-enqueueing resets the existing job instead of creating a duplicate.
 */
export async function enqueue(tx: Tx, kind: JobKind, payload: Record<string, unknown>, dedupeKey?: string, delayMs = 0) {
  const runAfter = new Date(Date.now() + delayMs);
  if (dedupeKey) {
    await tx.syncJob.upsert({
      where: { dedupeKey },
      update: { status: "QUEUED", attempts: 0, runAfter, payload: payload as Prisma.InputJsonValue, lastError: null },
      create: { kind, dedupeKey, payload: payload as Prisma.InputJsonValue, runAfter },
    });
  } else {
    await tx.syncJob.create({ data: { kind, payload: payload as Prisma.InputJsonValue, runAfter } });
  }
}

/** Exponential backoff: 30s, 1m, 2m, 4m ... capped at 1h. */
export function backoffMs(attempt: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
}
