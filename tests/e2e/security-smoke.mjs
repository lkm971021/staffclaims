// HTTP-level smoke + access-control test against a running server (demo accounts).
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const PW = "Demo-Claims-2026!";
const b = await chromium.launch();
async function as(email) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`); await p.fill("#email", email); await p.fill("#password", PW);
  await p.click("button:has-text('Sign in')"); await p.waitForLoadState("networkidle");
  return ctx;
}
const results = []; let fails = 0;
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };
const get = async (ctx, path) => { const r = await ctx.request.get(BASE + path, { maxRedirects: 0 }); return { s: r.status(), loc: r.headers()["location"] ?? "" }; };

// find Alice's claim + document ids via Finance
const fin = await as("finance@example.test");
const fp = await fin.newPage(); await fp.goto(`${BASE}/finance/claims`);
const claimHref = await fp.getAttribute("table a >> nth=0", "href");
const claimId = claimHref.split("/").pop();
await fp.goto(BASE + claimHref);
const docSrc = await fp.getAttribute("img[src^='/api/documents/']", "src").catch(() => null);
const docId = docSrc?.split("/").pop().split("?")[0];

for (const path of ["/finance", "/finance/claims", "/finance/payments", "/finance/reports", "/finance/reports?type=accounting", "/management", "/admin/categories", "/admin/audit", "/admin/jobs", "/notifications", claimHref])
  check(`finance can open ${path}`, (await get(fin, path)).s === 200);
for (const fmt of ["xlsx", "csv", "pdf"]) check(`finance export register ${fmt}`, (await get(fin, `/api/exports/report?type=register&format=${fmt}&year=2026`)).s === 200);
check("finance claim ZIP", (await get(fin, `/api/claims/${claimId}/zip`)).s === 200);
check("finance monthly ZIP", (await get(fin, `/api/exports/zip?year=2026&month=11`)).s === 200);
check("finance cannot open admin users", (await get(fin, "/admin/users")).loc.includes("/forbidden"));

const ben = await as("ben@example.test");
check("other staff: document blocked", (await get(ben, `/api/documents/${docId}`)).s === 404, docId);
check("other staff: summary PDF blocked", (await get(ben, `/api/claims/${claimId}/summary`)).s === 404);
check("other staff: supporting PDF blocked", (await get(ben, `/api/claims/${claimId}/supporting`)).s === 404);
check("other staff: ZIP blocked", (await get(ben, `/api/claims/${claimId}/zip`)).s === 404);
check("other staff: claim page blocked", (await get(ben, `/staff/claims/${claimId}`)).s === 404);
check("staff: finance dashboard blocked", (await get(ben, "/finance")).loc.includes("/forbidden"));
check("staff: exports blocked", (await get(ben, "/api/exports/report?type=register")).s === 403);
check("staff: management blocked", (await get(ben, "/management")).loc.includes("/forbidden"));
check("staff: admin blocked", (await get(ben, "/admin")).loc.includes("/forbidden"));
check("staff: cron blocked without secret", (await ben.request.post(`${BASE}/api/cron`)).status() === 401);

const dir = await as("director@example.test");
check("director: approvals page", (await get(dir, "/director")).s === 200);
check("director: finance register blocked", (await get(dir, "/finance/claims")).loc.includes("/forbidden"));
check("director: accounting export blocked", (await get(dir, "/api/exports/report?type=accounting")).s === 403);

const adm = await as("admin@example.test");
for (const path of ["/admin", "/admin/users", "/admin/users/new", "/admin/branches", "/admin/categories", "/admin/settings", "/admin/google", "/admin/jobs", "/admin/audit"])
  check(`admin can open ${path}`, (await get(adm, path)).s === 200);
check("admin: cannot see claim documents", (await get(adm, `/api/documents/${docId}`)).s === 404);

const anon = await b.newContext();
check("anonymous: document blocked", (await get(anon, `/api/documents/${docId}`)).s === 401);
check("anonymous: page redirects to login", (await get(anon, "/finance")).loc.includes("/login"));
const hdr = await anon.request.get(`${BASE}/login`);
check("security headers present", hdr.headers()["x-frame-options"] === "SAMEORIGIN" && hdr.headers()["x-content-type-options"] === "nosniff");
check("PWA manifest served", (await get(anon, "/manifest.webmanifest")).s === 200);
console.log(results.join("\n")); console.log(`\n${results.length - fails} passed, ${fails} failed`);
await b.close();
process.exit(fails ? 1 : 0);
