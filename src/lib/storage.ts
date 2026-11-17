import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "./db";

/**
 * Private file storage. Files are never served directly: every download goes through a
 * permission-checked route.
 *
 * Two backends (env STORAGE_BACKEND):
 *  - "local" (default): files on a persistent disk at STORAGE_DIR. Needs a persistent volume.
 *  - "drive": files are written straight into the Finance Google Drive (a private "FILE STORE"
 *    folder), then MOVED (not copied) into the claim's archive folder by the archiver. No server
 *    disk is needed, which suits Google Cloud Run. Requires Google to be connected.
 *
 * Storage keys: local keys are relative paths ("2026-11/<claimId>/<uuid>.jpg");
 * Drive keys are "drive:<fileId>".
 */
export type Backend = "local" | "drive";
export const storageBackend = (): Backend => (process.env.STORAGE_BACKEND === "drive" ? "drive" : "local");
export const isDriveKey = (key: string) => key.startsWith("drive:");
export const driveIdOf = (key: string) => key.slice("drive:".length);

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

// ---- small in-memory cache for Drive reads (receipts are viewed repeatedly during verification)
const CACHE_LIMIT = Number(process.env.FILE_CACHE_MB || 64) * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;
function remember(key: string, data: Buffer) {
  if (data.length > CACHE_LIMIT / 4) return;
  cache.delete(key);
  cache.set(key, data);
  cacheBytes += data.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_LIMIT) break;
    cache.delete(k);
    cacheBytes -= v.length;
  }
}

async function drive() {
  const { getDrive } = await import("./google/drive");
  const d = await getDrive();
  if (d.mode === "mock" && process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_DRIVE_STORAGE !== "1") {
    // Never silently keep files on a temporary container disk.
    throw new Error("File storage is Google Drive but Google is not connected. An administrator must connect Google (Admin › Google Drive & Sheets) before files can be uploaded.");
  }
  return d;
}

/** Folder for not-yet-archived files: <FILE STORE root>/<YYYY-MM>/<claim or batch id>/ */
async function stagingFolder(key: string) {
  const d = await drive();
  const settingKey = `fileStoreRoot:${d.mode}`;
  let root = (await prisma.setting.findUnique({ where: { key: settingKey } }))?.value as string | undefined;
  if (!root) {
    root = await d.createRoot("STAFF CLAIMS APP - FILE STORE (do not edit)");
    await prisma.setting.upsert({ where: { key: settingKey }, update: { value: root }, create: { key: settingKey, value: root } });
  }
  const [month, owner] = key.split("/");
  return { d, folder: await d.ensurePath(root, [month || "misc", owner || "misc"]) };
}

/**
 * Store bytes. Returns the storage key to save on the record.
 * (Local keys are returned unchanged; Drive returns "drive:<fileId>".)
 */
export async function putFile(key: string, data: Buffer, name?: string): Promise<string> {
  if (storageBackend() === "drive") {
    const { d, folder } = await stagingFolder(key);
    const id = await d.upload(folder, name || path.basename(key), "application/octet-stream", data, key.replace(/[^\w.-]/g, "_"));
    const dk = `drive:${id}`;
    remember(dk, data);
    return dk;
  }
  const p = safe(key);
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(p), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ p, data, { flag: "wx" }); // never overwrite
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  if (isDriveKey(key)) {
    const hit = cache.get(key);
    if (hit) return hit;
    const data = await (await drive()).download(driveIdOf(key));
    remember(key, data);
    return data;
  }
  return fs.readFile(/*turbopackIgnore: true*/ safe(key));
}

/** After a Drive file is moved/updated, keep the cache consistent. */
export function forget(key: string) {
  const v = cache.get(key);
  if (v) {
    cacheBytes -= v.length;
    cache.delete(key);
  }
}

export async function fileExists(key: string) {
  try {
    if (isDriveKey(key)) return Boolean(await getFile(key));
    await fs.access(/*turbopackIgnore: true*/ safe(key));
    return true;
  } catch {
    return false;
  }
}
