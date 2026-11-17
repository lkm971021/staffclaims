/**
 * Background worker: Google Drive archiving, Google Sheets sync, emails and reminders.
 * Run alongside the web app:  npm run worker
 * (Hosts without background processes can instead call POST /api/cron every few minutes.)
 */
import { tick } from "../lib/worker";

const INTERVAL = Number(process.env.WORKER_INTERVAL_MS || 5000);
let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

async function loop() {
  console.log(`[worker] started (every ${INTERVAL}ms)`);
  while (!stopping) {
    try {
      const r = await tick();
      if (r.picked) console.log(`[worker] processed ${r.picked} job(s): ${r.ok} ok, ${r.failed} failed`);
    } catch (e) {
      console.error("[worker] tick failed", e);
    }
    await new Promise((res) => setTimeout(res, INTERVAL));
  }
  console.log("[worker] stopped");
  process.exit(0);
}
loop();
