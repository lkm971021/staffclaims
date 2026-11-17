import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { respond } from "@/lib/exports";
import { toDecimal } from "@/lib/money";
import { monthLabel, ymdOf } from "@/lib/time";

export const runtime = "nodejs";

/** Monthly payment listing for one batch (Excel / PDF). */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !hasRole(u, "FINANCE")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const url = new URL(req.url);
  const b = await prisma.paymentBatch.findUnique({
    where: { id: url.searchParams.get("batch") ?? "" },
    include: { company: true, items: { include: { claim: { include: { claimant: { include: { branch: true } } } } }, orderBy: { claim: { ref: "asc" } } } },
  });
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const t = {
    title: `Payment listing ${b.ref}`,
    subtitle: `${b.company.name} · ${b.status === "POSTED" ? "PAID" : "DRAFT – not yet paid"} · payment date ${ymdOf(b.paymentDate) || "-"} · ${b.method ?? ""} · ref ${b.bankRef ?? "-"}`,
    headers: ["No.", "Claim Ref", "Claim Month", "Employee ID", "Employee", "Branch", "Payment Ref", "Amount (RM)"],
    rows: b.items.map((i, k) => [k + 1, i.claim.ref, monthLabel(i.claim.claimYear, i.claim.claimMonth), i.claim.claimant.employeeNo, i.claim.claimant.name, i.claim.claimant.branch?.name ?? "", i.paymentRef ?? b.bankRef ?? "", toDecimal(i.amountSen)]),
    money: [7],
    totals: true,
  };
  return respond(t, url.searchParams.get("format") ?? "xlsx", `${b.ref} payment listing`);
}
