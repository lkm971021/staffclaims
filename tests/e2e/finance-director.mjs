// Finance verifies -> Director approves -> Finance pays, through the real UI (desktop Chromium).
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.SHOTS || "/tmp";
const PW = "Demo-Claims-2026!";
const browser = await chromium.launch();
const errors = [];
async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await page.click("button:has-text('Sign in')");
  await page.waitForLoadState("networkidle");
  return page;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

// Finance
const fin = await login("finance@example.test");
await shot(fin, "10-finance-dashboard");
await fin.goto(`${BASE}/finance/claims?status=finance`);
await fin.click("table a >> nth=0");
await fin.waitForSelector("text=Finance verification — expense #1");
await shot(fin, "11-workspace");
await fin.click("button:has-text('✓ Verify')");
await fin.waitForSelector("text=Lines: 1 verified");
await fin.click("button:has-text('Mark Finance Verified')");
await fin.waitForSelector("text=Verified — sent to Director", { timeout: 20000 });
const claimUrl = fin.url();

// Director
const dir = await login("director@example.test");
await dir.goto(`${BASE}/director`);
await shot(dir, "12-director-queue");
await dir.click("ul a >> nth=0");
await dir.waitForSelector("text=Your decision");
await shot(dir, "13-director-review");
await dir.click("button:has-text('Approve')");
await dir.waitForURL(/\/director$/);

// Finance pays
await fin.goto(`${BASE}/finance/payments`);
await fin.check("input[aria-label^='Select CLM']");
await fin.click("button:has-text('Create payment batch')");
await fin.waitForURL(/\/finance\/payments\/c/);
await fin.fill("input[type=date]", "2026-11-17");
await fin.selectOption("select", "INSTANT TRANSFER (OCBC)");
await fin.fill("input[placeholder^='Or enter one per staff']", "OCBC-DEMO-0001");
fin.on("dialog", (d) => d.accept());
await fin.click("button:has-text('Mark batch as PAID')");
await fin.waitForSelector("text=This batch is recorded as paid", { timeout: 20000 });
await shot(fin, "14-batch-paid");
await fin.goto(claimUrl);
await shot(fin, "15-workspace-paid");
await fin.goto(`${BASE}/finance/reports?type=accounting`);
await shot(fin, "16-reports");
await fin.goto(`${BASE}/management`);
await shot(fin, "17-management");
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
