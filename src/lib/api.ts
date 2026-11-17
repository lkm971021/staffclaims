import "server-only";
import { NextResponse } from "next/server";
import { UserError } from "./claims";

export function jsonError(e: unknown) {
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error(e);
  return NextResponse.json({ error: "Server error. Please try again." }, { status: 500 });
}

/** Private, non-cacheable file response (no public URLs; every request is permission-checked). */
export function fileResponse(data: Buffer, mime: string, filename: string, download: boolean) {
  const safe = filename.replace(/[^\w.\- ()]+/g, "_");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // PDFs must render in the browser's built-in viewer (a sandbox CSP would block it); other files are locked down.
      ...(mime === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    },
  });
}
