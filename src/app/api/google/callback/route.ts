import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, hasRole } from "@/lib/rbac";
import { saveConnection } from "@/lib/google/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const base = process.env.NEXTAUTH_URL || new URL(req.url).origin;
  const u = await getCurrentUser();
  if (!u || !hasRole(u, "ADMIN")) return NextResponse.redirect(new URL("/login", base));
  const url = new URL(req.url);
  const state = (await cookies()).get("g_oauth_state")?.value;
  if (!state || state !== url.searchParams.get("state")) return NextResponse.redirect(new URL("/admin/google?error=Security check failed - please try connecting again.", base));
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL(`/admin/google?error=${encodeURIComponent(url.searchParams.get("error") ?? "Google did not return an authorisation code")}`, base));
  try {
    const email = await saveConnection(code, u.id);
    await audit(prisma, { id: u.id, name: u.name }, "GoogleCredential", "default", "CONNECT", undefined, { email });
    const res = NextResponse.redirect(new URL(`/admin/google?ok=${encodeURIComponent(`Connected as ${email}. Drive & Sheets are now LIVE.`)}`, base));
    res.cookies.delete("g_oauth_state");
    return res;
  } catch (e) {
    return NextResponse.redirect(new URL(`/admin/google?error=${encodeURIComponent((e as Error).message)}`, base));
  }
}
