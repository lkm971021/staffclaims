import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | typeof prisma;

export interface Actor {
  id: string;
  name: string;
}

/** Append-only audit record (the database rejects updates/deletes on AuditLog). */
export async function audit(
  tx: Tx,
  actor: Actor | null,
  entity: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
  ip?: string,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor?.id,
      actorName: actor?.name,
      entity,
      entityId,
      action,
      before: before === undefined ? undefined : (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue),
      after: after === undefined ? undefined : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
      ip,
    },
  });
}
