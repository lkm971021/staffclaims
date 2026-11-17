import "server-only";
import type { ClaimStatus, LineStatus, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { UserError } from "./claims";
import { hasRole, type SessionUser } from "./rbac";
import { transition, reimbursable, type Action } from "./workflow";
import { notify, notifyRole } from "./notify";
import { enqueue } from "./jobs";
import { fmt, parseToSen, rm } from "./money";
import { nextBatchRef, nextSupplementaryRef } from "./refs";
import { dateOnly, monthLabel, nowMY } from "./time";
import { getSettings } from "./settings";

type Tx = Prisma.TransactionClient;
const actor = (u: SessionUser) => ({ id: u.id, name: u.name });

async function claimFor(tx: Tx, id: string) {
  const c = await tx.claim.findUnique({ where: { id }, include: { lines: true, claimant: true, paymentItem: { include: { batch: true } } } });
  if (!c) throw new UserError("Claim not found.");
  return c;
}

async function record(tx: Tx, u: SessionUser, claimId: string, from: ClaimStatus, to: ClaimStatus, action: Action | string, role: string, remarks?: string | null) {
  await tx.workflowEvent.create({
    data: { claimId, fromStatus: from, toStatus: to, action, actorId: u.id, actorName: u.name, actorRole: role, remarks: remarks || null },
  });
  await enqueue(tx, "SHEETS_SYNC_CLAIM", { claimId }, `sheet:${claimId}`, 5_000);
  await enqueue(tx, "ARCHIVE_CLAIM", { claimId }, `archive:${claimId}`, 2_000);
}

function requireFinanceOnOthers(u: SessionUser, claimantId: string) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  if (u.id === claimantId) throw new UserError("You cannot process your own claim. Another Finance user must review it.");
}

const FINANCE_STAGE: ClaimStatus[] = ["PENDING_FINANCE", "CLARIFICATION"];

// ------------------------------------------------------------------ line-level verification

export async function setLineVerification(
  u: SessionUser,
  lineId: string,
  input: { status: LineStatus; verifiedAmount?: string | null; comment?: string | null; adjustmentReason?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const line = await tx.claimLine.findUnique({ where: { id: lineId }, include: { claim: true } });
    if (!line) throw new UserError("Line not found.");
    requireFinanceOnOthers(u, line.claim.claimantId);
    if (!FINANCE_STAGE.includes(line.claim.status)) throw new UserError("This claim is not at the Finance verification stage.");
    const comment = input.comment?.trim() || null;
    if ((input.status === "QUERIED" || input.status === "REJECTED") && !comment)
      throw new UserError("Please give a reason / query for the staff member.");

    let verifiedAmountSen: number | null = null;
    if (input.status === "VERIFIED") {
      verifiedAmountSen = input.verifiedAmount ? parseToSen(input.verifiedAmount) : line.amountSen;
      if (verifiedAmountSen === null || verifiedAmountSen < 0) throw new UserError("Invalid verified amount.");
      if (verifiedAmountSen > line.amountSen) throw new UserError("Verified amount cannot exceed the amount claimed.");
      const prevVerified = line.verifiedAmountSen ?? line.amountSen;
      if (verifiedAmountSen !== prevVerified) {
        const reason = input.adjustmentReason?.trim();
        if (!reason) throw new UserError("A reason is required when the verified amount differs from the amount claimed.");
        await tx.adjustment.create({
          data: { lineId, field: "verifiedAmountSen", oldValue: fmt(prevVerified), newValue: fmt(verifiedAmountSen), reason, byId: u.id, byName: u.name },
        });
      }
    }
    // never allow verifying while a possible duplicate is undecided
    if (input.status === "VERIFIED") {
      const open = await tx.duplicateFlag.count({ where: { lineId, decision: "OPEN" } });
      if (open) throw new UserError("Resolve the possible-duplicate warning on this line first.");
    }
    const adjReason = input.status === "VERIFIED" && verifiedAmountSen !== line.amountSen ? input.adjustmentReason?.trim() : null;
    const updated = await tx.claimLine.update({
      where: { id: lineId },
      data: { finStatus: input.status, verifiedAmountSen, finComment: comment ?? adjReason ?? null, finCheckedById: u.id, finCheckedAt: new Date() },
    });
    await audit(tx, actor(u), "ClaimLine", lineId, `LINE_${input.status}`, { finStatus: line.finStatus, verifiedAmountSen: line.verifiedAmountSen }, { finStatus: updated.finStatus, verifiedAmountSen, comment });
    return updated;
  });
}

export async function setHardcopy(u: SessionUser, lineId: string, received: boolean) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  const line = await prisma.claimLine.update({
    where: { id: lineId },
    data: received ? { hardcopyReceivedAt: new Date(), hardcopyReceivedBy: u.name } : { hardcopyReceivedAt: null, hardcopyReceivedBy: null },
  });
  await audit(prisma, actor(u), "ClaimLine", lineId, received ? "HARDCOPY_RECEIVED" : "HARDCOPY_UNMARKED");
  await enqueue(prisma, "SHEETS_SYNC_CLAIM", { claimId: line.claimId }, `sheet:${line.claimId}`, 5_000);
  return line;
}

export async function setAdvance(u: SessionUser, claimId: string, amount: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const c = await claimFor(tx, claimId);
    requireFinanceOnOthers(u, c.claimantId);
    if (!FINANCE_STAGE.includes(c.status)) throw new UserError("Advance can only be set during Finance verification.");
    const sen = parseToSen(amount || "0");
    if (sen === null || sen < 0) throw new UserError("Invalid advance amount.");
    if (!reason?.trim()) throw new UserError("Reason / reference for the advance is required.");
    await tx.claim.update({ where: { id: claimId }, data: { advanceSen: sen } });
    await audit(tx, actor(u), "Claim", claimId, "SET_ADVANCE", { advanceSen: c.advanceSen }, { advanceSen: sen, reason });
  });
}

export async function resolveDuplicate(u: SessionUser, flagId: string, decision: "NOT_DUPLICATE" | "DUPLICATE", explanation: string) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  if (!explanation?.trim()) throw new UserError("Please record an explanation for this decision.");
  const flag = await prisma.duplicateFlag.update({
    where: { id: flagId },
    data: { decision, explanation: explanation.trim(), decidedById: u.id, decidedAt: new Date() },
    include: { line: true },
  });
  await audit(prisma, actor(u), "DuplicateFlag", flagId, `DUPLICATE_${decision}`, undefined, { explanation, lineId: flag.lineId, matchedLineId: flag.matchedLineId });
  return flag;
}

// ------------------------------------------------------------------ claim-level Finance actions

export async function financeVerify(u: SessionUser, claimId: string, remarks: string | null, opts: { splitQueried: boolean }) {
  return prisma.$transaction(
    async (tx) => {
      const c = await claimFor(tx, claimId);
      requireFinanceOnOthers(u, c.claimantId);
      const queried = c.lines.filter((l) => l.finStatus === "QUERIED");
      let supplementaryRef: string | null = null;

      if (queried.length && opts.splitQueried && c.lines.some((l) => l.finStatus === "VERIFIED")) {
        // Move queried lines to a supplementary claim returned to the staff member, so verified lines can proceed.
        const ref = await nextSupplementaryRef(tx, c.ref);
        const sup = await tx.claim.create({
          data: {
            ref, companyId: c.companyId, claimantId: c.claimantId, submittedById: c.submittedById, claimYear: c.claimYear,
            claimMonth: c.claimMonth, status: "RETURNED", isDirectorOwnClaim: c.isDirectorOwnClaim, parentClaimId: c.id,
            firstSubmittedAt: c.firstSubmittedAt, submittedAt: c.submittedAt, financeRemarks: "Queried lines carried forward from " + c.ref,
          },
        });
        let n = 1;
        for (const l of queried) {
          await tx.claimLine.update({ where: { id: l.id }, data: { claimId: sup.id, lineNo: 1000 + n } });
          await tx.claimLine.update({ where: { id: l.id }, data: { lineNo: n++ } });
          await tx.document.updateMany({ where: { lineId: l.id }, data: { claimId: sup.id } });
        }
        const rest = await tx.claimLine.findMany({ where: { claimId }, orderBy: { lineNo: "asc" } });
        for (let i = 0; i < rest.length; i++) await tx.claimLine.update({ where: { id: rest[i].id }, data: { lineNo: 1000 + i } });
        for (let i = 0; i < rest.length; i++) await tx.claimLine.update({ where: { id: rest[i].id }, data: { lineNo: i + 1 } });
        await tx.workflowEvent.create({
          data: {
            claimId: sup.id, fromStatus: null, toStatus: "RETURNED", action: "SUPPLEMENTARY_CREATED", actorId: u.id, actorName: u.name, actorRole: "FINANCE",
            remarks: `Queried lines moved from ${c.ref}: ${queried.map((q) => `${q.supplier} ${rm(q.amountSen)} (${q.finComment})`).join("; ")}`,
          },
        });
        await notify(tx, [c.claimantId], {
          type: "CLAIM_RETURNED",
          title: `Action needed: ${ref}`,
          body: `Finance has queries on ${queried.length} expense(s) from ${c.ref}. Please correct and resubmit.`,
          claimId: sup.id,
          link: `/staff/claims/${sup.id}`,
        });
        await enqueue(tx, "SHEETS_SYNC_CLAIM", { claimId: sup.id }, `sheet:${sup.id}`, 5_000);
        supplementaryRef = ref;
      }

      const fresh = await claimFor(tx, claimId);
      const t = transition("FINANCE_VERIFY", {
        status: fresh.status, actorRoles: u.roles, actorId: u.id, claimantId: fresh.claimantId,
        isDirectorOwnClaim: fresh.isDirectorOwnClaim, actorCanSubmitFor: false, lineStatuses: fresh.lines.map((l) => l.finStatus),
      });
      if (!t.ok) throw new UserError(t.error);
      const openDup = await tx.duplicateFlag.count({ where: { line: { claimId }, decision: "OPEN" } });
      if (openDup) throw new UserError("Resolve all possible-duplicate warnings before completing verification.");

      await tx.claim.update({
        where: { id: claimId },
        data: { status: t.to!, financeVerifiedAt: new Date(), financeVerifiedById: u.id, financeRemarks: remarks || fresh.financeRemarks },
      });
      const amount = rm(reimbursable(fresh.lines, fresh.advanceSen));
      const note = fresh.isDirectorOwnClaim ? "Director's own claim - Finance verification final (company rule)" : null;
      await record(tx, u, claimId, fresh.status, t.to!, "FINANCE_VERIFY", "FINANCE", [remarks, note, supplementaryRef ? `Queried lines moved to ${supplementaryRef}` : null].filter(Boolean).join(" | "));
      await audit(tx, actor(u), "Claim", claimId, "FINANCE_VERIFY", { status: fresh.status }, { status: t.to, amount, supplementaryRef });

      if (t.to === "PENDING_DIRECTOR") {
        await notifyRole(tx, "DIRECTOR", {
          type: "PENDING_DIRECTOR", title: `Approval needed: ${fresh.ref}`,
          body: `${fresh.claimant.name} - ${monthLabel(fresh.claimYear, fresh.claimMonth)} - ${amount} (Finance verified)`,
          claimId, link: `/director/claims/${claimId}`,
        }, fresh.claimantId);
        await notify(tx, [fresh.claimantId], { type: "FINANCE_VERIFIED", title: `${fresh.ref} verified by Finance`, body: `Now pending Director approval. Verified amount ${amount}.`, claimId, link: `/staff/claims/${claimId}` });
      } else {
        await notify(tx, [fresh.claimantId], { type: "APPROVED", title: `${fresh.ref} approved for payment`, body: `Verified amount ${amount}.`, claimId, link: `/staff/claims/${claimId}` });
      }
      return { status: t.to, supplementaryRef };
    },
    { timeout: 60_000 },
  );
}

async function simpleTransition(u: SessionUser, claimId: string, action: Action, remarks: string | null, requireRemarks: boolean) {
  if (requireRemarks && !remarks?.trim()) throw new UserError("Please enter the reason / remarks.");
  return prisma.$transaction(async (tx) => {
    const c = await claimFor(tx, claimId);
    const t = transition(action, {
      status: c.status, actorRoles: u.roles, actorId: u.id, claimantId: c.claimantId, isDirectorOwnClaim: c.isDirectorOwnClaim,
      actorCanSubmitFor: false, lineStatuses: c.lines.map((l) => l.finStatus),
    });
    if (!t.ok) throw new UserError(t.error);
    const role = action.startsWith("DIRECTOR") ? "DIRECTOR" : "FINANCE";
    const data: Prisma.ClaimUpdateInput = { status: t.to };
    if (role === "DIRECTOR") Object.assign(data, { directorDecidedAt: new Date(), directorDecidedById: u.id, directorRemarks: remarks });
    else Object.assign(data, { financeRemarks: remarks });
    if (t.to === "REJECTED") data.rejectedAt = new Date();
    if (action === "FINANCE_RETURN") data.financeVerifiedAt = null;
    await tx.claim.update({ where: { id: claimId }, data });
    await record(tx, u, claimId, c.status, t.to!, action, role, remarks);
    await audit(tx, actor(u), "Claim", claimId, action, { status: c.status }, { status: t.to, remarks });

    const link = `/staff/claims/${claimId}`;
    const total = rm(reimbursable(c.lines, c.advanceSen));
    switch (action) {
      case "FINANCE_RETURN":
        await notify(tx, [c.claimantId], { type: "CLAIM_RETURNED", title: `Action needed: ${c.ref} returned`, body: remarks ?? "", claimId, link });
        break;
      case "FINANCE_REJECT":
      case "DIRECTOR_REJECT":
        await notify(tx, [c.claimantId], { type: "CLAIM_REJECTED", title: `${c.ref} rejected`, body: remarks ?? "", claimId, link });
        if (action === "DIRECTOR_REJECT") await notifyRole(tx, "FINANCE", { type: "CLAIM_REJECTED", title: `Director rejected ${c.ref}`, body: remarks ?? "", claimId, link: `/finance/claims/${claimId}` });
        break;
      case "DIRECTOR_APPROVE":
        await notify(tx, [c.claimantId], { type: "APPROVED", title: `${c.ref} approved by Director`, body: `Approved amount ${total}. Payment will be arranged.`, claimId, link });
        await notifyRole(tx, "FINANCE", { type: "READY_FOR_PAYMENT", title: `${c.ref} ready for payment`, body: `${c.claimant.name} - ${total}`, claimId, link: `/finance/payments` });
        break;
      case "DIRECTOR_CLARIFY":
        await notifyRole(tx, "FINANCE", { type: "CLARIFICATION", title: `Director query on ${c.ref}`, body: remarks ?? "", claimId, link: `/finance/claims/${claimId}` });
        break;
    }
    return t.to;
  });
}

export const financeReturn = (u: SessionUser, id: string, remarks: string) => simpleTransition(u, id, "FINANCE_RETURN", remarks, true);
export const financeReject = (u: SessionUser, id: string, remarks: string) => simpleTransition(u, id, "FINANCE_REJECT", remarks, true);
export const directorApprove = (u: SessionUser, id: string, remarks: string | null) => simpleTransition(u, id, "DIRECTOR_APPROVE", remarks, false);
export const directorReject = (u: SessionUser, id: string, remarks: string) => simpleTransition(u, id, "DIRECTOR_REJECT", remarks, true);
export const directorClarify = (u: SessionUser, id: string, remarks: string) => simpleTransition(u, id, "DIRECTOR_CLARIFY", remarks, true);

// ------------------------------------------------------------------ payment batches

export async function createBatch(u: SessionUser, claimIds: string[]) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  if (!claimIds.length) throw new UserError("Select at least one approved claim.");
  return prisma.$transaction(async (tx) => {
    const claims = await tx.claim.findMany({ where: { id: { in: claimIds } }, include: { lines: true, paymentItem: true } });
    if (claims.length !== claimIds.length) throw new UserError("Some claims were not found.");
    const companies = new Set(claims.map((c) => c.companyId));
    if (companies.size > 1) throw new UserError("A payment batch must contain claims of one company only.");
    for (const c of claims) {
      if (c.status !== "APPROVED_FOR_PAYMENT") throw new UserError(`${c.ref} is not approved for payment.`);
      if (c.paymentItem) throw new UserError(`${c.ref} is already in a payment batch.`);
    }
    const { year, month } = nowMY();
    const ref = await nextBatchRef(tx, year, month);
    const batch = await tx.paymentBatch.create({ data: { ref, companyId: claims[0].companyId, createdById: u.id } });
    for (const c of claims) {
      const amt = reimbursable(c.lines, c.advanceSen);
      if (amt <= 0) throw new UserError(`${c.ref} has no reimbursable amount.`);
      await tx.paymentItem.create({ data: { batchId: batch.id, claimId: c.id, amountSen: amt } });
    }
    await audit(tx, actor(u), "PaymentBatch", batch.id, "CREATE_BATCH", undefined, { ref, claims: claims.map((c) => c.ref) });
    return batch;
  });
}

export async function removeFromBatch(u: SessionUser, batchId: string, claimId: string) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  await prisma.$transaction(async (tx) => {
    const b = await tx.paymentBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (b.status !== "DRAFT") throw new UserError("Only draft batches can be changed.");
    await tx.paymentItem.delete({ where: { claimId } });
    await audit(tx, actor(u), "PaymentBatch", batchId, "REMOVE_CLAIM", { claimId });
  });
}

export async function cancelBatch(u: SessionUser, batchId: string) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  await prisma.$transaction(async (tx) => {
    const b = await tx.paymentBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (b.status !== "DRAFT") throw new UserError("Only draft batches can be cancelled.");
    await tx.paymentItem.deleteMany({ where: { batchId } });
    await tx.paymentBatch.update({ where: { id: batchId }, data: { status: "CANCELLED" } });
    await audit(tx, actor(u), "PaymentBatch", batchId, "CANCEL_BATCH");
  });
}

export async function updateBatchDetails(
  u: SessionUser,
  batchId: string,
  d: { paymentDate?: string | null; method?: string | null; bankRef?: string | null; remarks?: string | null; itemRefs?: Record<string, string> },
) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  const s = await getSettings();
  if (d.method && !s.reimbursementMethods.includes(d.method)) throw new UserError("Invalid payment method.");
  return prisma.$transaction(async (tx) => {
    const b = await tx.paymentBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (b.status !== "DRAFT") throw new UserError("Posted batches cannot be changed.");
    const upd = await tx.paymentBatch.update({
      where: { id: batchId },
      data: {
        paymentDate: d.paymentDate ? dateOnly(d.paymentDate) : null,
        method: d.method || null,
        bankRef: d.bankRef?.trim() || null,
        remarks: d.remarks?.trim() || null,
      },
    });
    for (const [claimId, ref] of Object.entries(d.itemRefs ?? {}))
      await tx.paymentItem.updateMany({ where: { batchId, claimId }, data: { paymentRef: ref.trim() || null } });
    await audit(tx, actor(u), "PaymentBatch", batchId, "UPDATE_BATCH", b, upd);
    return upd;
  });
}

/** Mark every claim in the batch as Paid. Requires payment date, method and reference. */
export async function postBatch(u: SessionUser, batchId: string) {
  if (!hasRole(u, "FINANCE")) throw new UserError("Finance access required.");
  return prisma.$transaction(
    async (tx) => {
      const b = await tx.paymentBatch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { include: { claim: { include: { lines: true } } } } } });
      if (b.status !== "DRAFT") throw new UserError("This batch has already been posted or cancelled.");
      if (!b.items.length) throw new UserError("The batch has no claims.");
      if (!b.paymentDate || !b.method) throw new UserError("Enter the payment date and payment method before marking as Paid.");
      const missingRef = b.items.filter((i) => !i.paymentRef && !b.bankRef);
      if (missingRef.length) throw new UserError("Enter a payment reference (batch reference or one per claim).");
      for (const it of b.items) {
        const c = it.claim;
        const t = transition("MARK_PAID", {
          status: c.status, actorRoles: u.roles, actorId: u.id, claimantId: c.claimantId, isDirectorOwnClaim: c.isDirectorOwnClaim, actorCanSubmitFor: false,
        });
        if (!t.ok) throw new UserError(`${c.ref}: ${t.error}`);
        // amount must still agree with the approved figures
        const amt = reimbursable(c.lines, c.advanceSen);
        if (amt !== it.amountSen) throw new UserError(`${c.ref}: approved amount changed since the batch was prepared. Remove and re-add it.`);
        await tx.claim.update({ where: { id: c.id }, data: { status: "PAID", paidAt: new Date(), reimbursementMethod: b.method } });
        await record(tx, u, c.id, c.status, "PAID", "MARK_PAID", "FINANCE", `Batch ${b.ref}, ${b.method}, ref ${it.paymentRef ?? b.bankRef}`);
        await notify(tx, [c.claimantId], {
          type: "PAID", title: `${c.ref} paid`, body: `${rm(it.amountSen)} paid on ${b.paymentDate.toISOString().slice(0, 10)} by ${b.method}.`,
          claimId: c.id, link: `/staff/claims/${c.id}`,
        });
      }
      await tx.paymentBatch.update({ where: { id: batchId }, data: { status: "POSTED", postedById: u.id, postedAt: new Date() } });
      await audit(tx, actor(u), "PaymentBatch", batchId, "POST_BATCH", undefined, { ref: b.ref, claims: b.items.map((i) => i.claim.ref) });
      await enqueue(tx, "SHEETS_SYNC_BATCH", { batchId }, `sheetbatch:${batchId}`, 5_000);
    },
    { timeout: 60_000 },
  );
}
