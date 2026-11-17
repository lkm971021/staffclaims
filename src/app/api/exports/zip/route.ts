import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { parseFilters, claimWhere } from "@/lib/filters";
import { buildReport } from "@/lib/reports";
import { toXlsx } from "@/lib/exports";
import { zipClaims } from "@/lib/zip";

export const runtime = "nodejs";

/** All supporting documents + register for the filtered claims (e.g. one month) in one ZIP, for audit. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !hasRole(u, "FINANCE")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const f = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
  if (!f.year) return NextResponse.json({ error: "Choose at least a year (and preferably a month) before downloading documents." }, { status: 400 });
  const ids = (await prisma.claim.findMany({ where: claimWhere(f, u), select: { id: true } })).map((c) => c.id);
  if (ids.length > 1500) return NextResponse.json({ error: "Too many claims for one ZIP. Narrow the filter (e.g. by month)." }, { status: 400 });
  const register = await toXlsx([await buildReport("register", f, u), await buildReport("claims", f, u)]);
  const name = `Staff Claims ${f.year}${f.month ? "-" + String(f.month).padStart(2, "0") : ""} documents`;
  return zipClaims(u, ids, name, [{ name: "Master Claim Register.xlsx", data: register }]);
}
