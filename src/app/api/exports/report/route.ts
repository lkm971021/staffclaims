import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/rbac";
import { parseFilters } from "@/lib/filters";
import { buildReport, REPORTS, type ReportKey } from "@/lib/reports";
import { respond } from "@/lib/exports";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !(hasRole(u, "FINANCE") || hasRole(u, "DIRECTOR"))) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "register") as ReportKey;
  if (!(type in REPORTS)) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  // Directors may export approval-stage listings only
  if (!hasRole(u, "FINANCE") && !["pending-director", "approved-unpaid", "monthly-paid", "branch", "by-category", "monthly-staff"].includes(type))
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const f = parseFilters(Object.fromEntries(url.searchParams));
  const t = await buildReport(type, f, u);
  const format = url.searchParams.get("format") ?? "xlsx";
  await audit(prisma, { id: u.id, name: u.name }, "Export", type, "EXPORT", undefined, { format, filters: f, rows: t.rows.length });
  const stamp = new Date().toISOString().slice(0, 10);
  return respond(t, format, `${t.title.replace(/^\d+\.\s*/, "")} ${f.year ?? ""}${f.month ? "-" + String(f.month).padStart(2, "0") : ""} (${stamp})`.trim());
}
