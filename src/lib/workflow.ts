/**
 * Claim workflow rules (pure functions - no database access, fully unit-tested).
 *
 *  DRAFT --submit--> PENDING_FINANCE --verify--> PENDING_DIRECTOR --approve--> APPROVED_FOR_PAYMENT --pay--> PAID
 *    ^                  |    |    \                  |      \
 *    |                  |    |     \--reject--> REJECTED      \--reject--> REJECTED
 *    +---- RETURNED <---+    |                                 \--clarify--> CLARIFICATION --(Finance)--> PENDING_DIRECTOR / RETURNED / REJECTED
 *                            +--verify (Director's own claim: Finance verification is final)--> APPROVED_FOR_PAYMENT
 *
 * Nothing advances automatically: every transition is an explicit action by a named user.
 */
import type { ClaimStatus, LineStatus, Role } from "@prisma/client";

export type Action =
  | "SUBMIT"
  | "RESUBMIT"
  | "FINANCE_VERIFY"
  | "FINANCE_RETURN"
  | "FINANCE_REJECT"
  | "DIRECTOR_APPROVE"
  | "DIRECTOR_REJECT"
  | "DIRECTOR_CLARIFY"
  | "MARK_PAID";

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  PENDING_FINANCE: "Pending Finance Verification",
  RETURNED: "Returned to Staff",
  PENDING_DIRECTOR: "Finance Verified – Pending Director Approval",
  CLARIFICATION: "Clarification Requested by Director",
  APPROVED_FOR_PAYMENT: "Approved for Payment",
  PAID: "Paid",
  REJECTED: "Rejected",
};

export const STATUS_SHORT: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  PENDING_FINANCE: "Submitted",
  RETURNED: "Returned",
  PENDING_DIRECTOR: "Pending Director",
  CLARIFICATION: "Clarification",
  APPROVED_FOR_PAYMENT: "Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
};

export const STATUS_TONE: Record<ClaimStatus, "gray" | "blue" | "amber" | "violet" | "green" | "red" | "teal"> = {
  DRAFT: "gray",
  PENDING_FINANCE: "blue",
  RETURNED: "amber",
  PENDING_DIRECTOR: "violet",
  CLARIFICATION: "amber",
  APPROVED_FOR_PAYMENT: "teal",
  PAID: "green",
  REJECTED: "red",
};

/** Statuses in which staff may edit lines and documents. */
export const STAFF_EDITABLE: ClaimStatus[] = ["DRAFT", "RETURNED"];

interface TransitionCtx {
  status: ClaimStatus;
  actorRoles: Role[];
  actorId: string;
  claimantId: string;
  isDirectorOwnClaim: boolean;
  /** true if actor is claimant or an active team leader of claimant */
  actorCanSubmitFor: boolean;
  lineStatuses?: LineStatus[];
  inPostedBatch?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  to?: ClaimStatus;
  error?: string;
}

const has = (roles: Role[], r: Role) => roles.includes(r);

export function transition(action: Action, c: TransitionCtx): TransitionResult {
  const fail = (error: string): TransitionResult => ({ ok: false, error });
  const self = c.actorId === c.claimantId;

  switch (action) {
    case "SUBMIT":
      if (c.status !== "DRAFT") return fail("Only a draft can be submitted.");
      if (!c.actorCanSubmitFor) return fail("You may only submit your own claims or those of your assigned team members.");
      return { ok: true, to: "PENDING_FINANCE" };

    case "RESUBMIT":
      if (c.status !== "RETURNED") return fail("Only a returned claim can be resubmitted.");
      if (!c.actorCanSubmitFor) return fail("You may only resubmit your own claims or those of your assigned team members.");
      return { ok: true, to: "PENDING_FINANCE" };

    case "FINANCE_VERIFY": {
      if (!has(c.actorRoles, "FINANCE")) return fail("Only Finance can verify claims.");
      if (self) return fail("You cannot verify your own claim. Another Finance user must verify it.");
      if (c.status !== "PENDING_FINANCE" && c.status !== "CLARIFICATION")
        return fail("Claim is not awaiting Finance verification.");
      const ls = c.lineStatuses ?? [];
      if (ls.length === 0) return fail("Claim has no expense lines.");
      if (ls.some((s) => s === "PENDING")) return fail("Every expense line must be marked Verified, Queried or Rejected first.");
      if (!ls.some((s) => s === "VERIFIED")) return fail("No line is verified. Return or reject the claim instead.");
      // Queried lines are moved to a supplementary claim by the caller before this transition.
      if (ls.some((s) => s === "QUERIED")) return fail("Queried lines must be returned to staff or moved to a supplementary claim first.");
      return { ok: true, to: c.isDirectorOwnClaim ? "APPROVED_FOR_PAYMENT" : "PENDING_DIRECTOR" };
    }

    case "FINANCE_RETURN":
      if (!has(c.actorRoles, "FINANCE")) return fail("Only Finance can return claims.");
      if (self) return fail("You cannot process your own claim.");
      if (c.status !== "PENDING_FINANCE" && c.status !== "CLARIFICATION") return fail("Claim is not with Finance.");
      return { ok: true, to: "RETURNED" };

    case "FINANCE_REJECT":
      if (!has(c.actorRoles, "FINANCE")) return fail("Only Finance can reject claims at verification.");
      if (self) return fail("You cannot process your own claim.");
      if (c.status !== "PENDING_FINANCE" && c.status !== "CLARIFICATION") return fail("Claim is not with Finance.");
      return { ok: true, to: "REJECTED" };

    case "DIRECTOR_APPROVE":
    case "DIRECTOR_REJECT":
    case "DIRECTOR_CLARIFY":
      if (!has(c.actorRoles, "DIRECTOR")) return fail("Only the Director can approve or reject at this stage.");
      if (self) return fail("You cannot approve your own claim.");
      if (c.status !== "PENDING_DIRECTOR") return fail("Claim is not awaiting Director approval.");
      return {
        ok: true,
        to: action === "DIRECTOR_APPROVE" ? "APPROVED_FOR_PAYMENT" : action === "DIRECTOR_REJECT" ? "REJECTED" : "CLARIFICATION",
      };

    case "MARK_PAID":
      if (!has(c.actorRoles, "FINANCE")) return fail("Only Finance can record payments.");
      if (c.status !== "APPROVED_FOR_PAYMENT") return fail("Only claims approved for payment can be paid.");
      if (c.inPostedBatch) return fail("This claim has already been paid in a posted payment batch.");
      return { ok: true, to: "PAID" };
  }
}

/** Reimbursable amount of a claim = verified lines (verified amount) - advance. */
export function reimbursable(
  lines: { finStatus: LineStatus; amountSen: number; verifiedAmountSen: number | null }[],
  advanceSen: number,
): number {
  const verified = lines
    .filter((l) => l.finStatus === "VERIFIED")
    .reduce((a, l) => a + (l.verifiedAmountSen ?? l.amountSen), 0);
  return verified - advanceSen;
}

export function submittedTotal(lines: { amountSen: number }[]) {
  return lines.reduce((a, l) => a + l.amountSen, 0);
}
