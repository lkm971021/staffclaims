import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Private file storage (never served directly - every download goes through a permission-checked
 * route). Files are written here first, so a claim is never lost if Google Drive is unavailable.
 * In production STORAGE_DIR must be a persistent volume (see docs/DEPLOYMENT.md).
 */
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR || "./storage");

function safe(key: string) {
  const p = path.resolve(/*turbopackIgnore: true*/ ROOT, key);
  if (!p.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
  return p;
}

export function newKey(claimId: string, ext: string) {
  const d = new Date().toISOString().slice(0, 7);
  return `${d}/${claimId}/${randomUUID()}${ext}`;
}

export async function putFile(key: string, data: Buffer) {
  const p = safe(key);
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(p), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ p, data, { flag: "wx" }); // never overwrite
}

export async function getFile(key: string): Promise<Buffer> {
  return fs.readFile(/*turbopackIgnore: true*/ safe(key));
}

export async function fileExists(key: string) {
  try {
    await fs.access(/*turbopackIgnore: true*/ safe(key));
    return true;
  } catch {
    return false;
  }
}
