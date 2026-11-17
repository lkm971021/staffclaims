import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getCurrentUser, hasRole } from "@/lib/rbac";
import { consentUrl, googleConfigured } from "@/lib/google/auth";

export async function GET() {
  const u = await getCurrentUser();
  if (!u || !hasRole(u, "ADMIN")) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!googleConfigured()) return NextResponse.redirect(new URL("/admin/google?error=Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first", process.env.NEXTAUTH_URL));
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(consentUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/google" });
  return res;
}
