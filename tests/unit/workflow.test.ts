import { describe, expect, it } from "vitest";
import { transition, reimbursable } from "@/lib/workflow";

const base = { actorId: "fin", claimantId: "staff", isDirectorOwnClaim: false, actorCanSubmitFor: false };

describe("claim workflow", () => {
  it("staff submit draft -> pending finance", () => {
    expect(transition("SUBMIT", { ...base, status: "DRAFT", actorRoles: ["STAFF"], actorId: "staff", actorCanSubmitFor: true }).to).toBe("PENDING_FINANCE");
  });
  it("cannot submit someone else's claim without delegation", () => {
    expect(transition("SUBMIT", { ...base, status: "DRAFT", actorRoles: ["STAFF"], actorId: "x" }).ok).toBe(false);
  });
  it("Finance verification required before Director", () => {
    expect(transition("DIRECTOR_APPROVE", { ...base, status: "PENDING_FINANCE", actorRoles: ["DIRECTOR"], actorId: "dir" }).ok).toBe(false);
  });
  it("Finance cannot verify while lines are pending", () => {
    const r = transition("FINANCE_VERIFY", { ...base, status: "PENDING_FINANCE", actorRoles: ["FINANCE"], lineStatuses: ["VERIFIED", "PENDING"] });
    expect(r.ok).toBe(false);
  });
  it("Finance verify -> pending director", () => {
    const r = transition("FINANCE_VERIFY", { ...base, status: "PENDING_FINANCE", actorRoles: ["FINANCE"], lineStatuses: ["VERIFIED", "REJECTED"] });
    expect(r.to).toBe("PENDING_DIRECTOR");
  });
  it("Director's own claim: Finance verification is final", () => {
    const r = transition("FINANCE_VERIFY", { ...base, status: "PENDING_FINANCE", actorRoles: ["FINANCE"], isDirectorOwnClaim: true, lineStatuses: ["VERIFIED"] });
    expect(r.to).toBe("APPROVED_FOR_PAYMENT");
  });
  it("no self-verification and no self-approval", () => {
    expect(transition("FINANCE_VERIFY", { ...base, actorId: "staff", status: "PENDING_FINANCE", actorRoles: ["FINANCE"], lineStatuses: ["VERIFIED"] }).ok).toBe(false);
    expect(transition("DIRECTOR_APPROVE", { ...base, actorId: "staff", status: "PENDING_DIRECTOR", actorRoles: ["DIRECTOR"] }).ok).toBe(false);
  });
  it("only approved claims can be paid, and never twice", () => {
    expect(transition("MARK_PAID", { ...base, status: "PENDING_DIRECTOR", actorRoles: ["FINANCE"] }).ok).toBe(false);
    expect(transition("MARK_PAID", { ...base, status: "PAID", actorRoles: ["FINANCE"] }).ok).toBe(false);
    expect(transition("MARK_PAID", { ...base, status: "APPROVED_FOR_PAYMENT", actorRoles: ["FINANCE"] }).to).toBe("PAID");
  });
  it("staff cannot approve or pay", () => {
    for (const a of ["FINANCE_VERIFY", "DIRECTOR_APPROVE", "MARK_PAID"] as const)
      expect(transition(a, { ...base, status: "APPROVED_FOR_PAYMENT", actorRoles: ["STAFF"], lineStatuses: ["VERIFIED"] }).ok).toBe(false);
  });
  it("director clarification returns to Finance queue", () => {
    expect(transition("DIRECTOR_CLARIFY", { ...base, actorId: "dir", status: "PENDING_DIRECTOR", actorRoles: ["DIRECTOR"] }).to).toBe("CLARIFICATION");
    expect(transition("FINANCE_VERIFY", { ...base, status: "CLARIFICATION", actorRoles: ["FINANCE"], lineStatuses: ["VERIFIED"] }).to).toBe("PENDING_DIRECTOR");
  });
  it("partial verification amount excludes rejected lines and uses verified amounts", () => {
    const lines = [
      { finStatus: "VERIFIED" as const, amountSen: 10000, verifiedAmountSen: 10000 },
      { finStatus: "REJECTED" as const, amountSen: 5000, verifiedAmountSen: null },
      { finStatus: "VERIFIED" as const, amountSen: 8000, verifiedAmountSen: 7000 },
    ];
    expect(reimbursable(lines, 0)).toBe(17000);
    expect(reimbursable(lines, 2000)).toBe(15000);
  });
});
