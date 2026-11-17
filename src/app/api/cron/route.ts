import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { tick } from "@/lib/worker";

export const runtime = "nodejs";
export const maxDuration = 300;

/** For hosts without a background worker: call POST /api/cron every 1-5 minutes with header
 *  "Authorization: Bearer <CRON_SECRET>". Runs queued Drive/Sheets/email jobs and reminders. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await tick());
}
