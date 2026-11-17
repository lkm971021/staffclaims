/**
 * Restore a database backup (downloaded from the Drive folder "STAFF CLAIMS APP - DATABASE BACKUPS").
 *
 *   1. Point DATABASE_URL at a NEW, EMPTY database
 *   2. npx prisma migrate deploy
 *   3. npx tsx scripts/restore-backup.ts ./staff-claims-db-2026-11-17-....json.gz
 *
 * The script refuses to run against a database that already has users or claims.
 * Uploaded files are not inside the backup - they stay in Google Drive and are referenced by id.
 */
import { promises as fs } from "fs";
import { restoreDatabase } from "../src/lib/backup";
import { prisma } from "../src/lib/db";

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npx tsx scripts/restore-backup.ts <backup.json.gz>");
  const counts = await restoreDatabase(await fs.readFile(file));
  console.log("Restored rows:", counts);
})()
  .catch((e) => {
    console.error("Restore failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
