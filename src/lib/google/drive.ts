import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { google, type drive_v3 } from "googleapis";
import { authedClient } from "./auth";
import { prisma } from "../db";

const APP_TAG = "staffclaims";
const FOLDER_MIME = "application/vnd.google-apps.folder";
export const MOCK_ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.MOCK_DRIVE_DIR || "./mock-drive");

export interface DriveAdapter {
  mode: "live" | "mock";
  /** Ensure a nested folder path under a root folder; returns the leaf folder id. Idempotent. */
  ensurePath(rootId: string, parts: string[]): Promise<string>;
  /** Create a root folder (in My Drive root). */
  createRoot(name: string): Promise<string>;
  /** Upload a file once. If a file with the same appKey already exists in the folder, it is returned instead. */
  upload(folderId: string, name: string, mime: string, data: Buffer, appKey: string): Promise<string>;
  /** Replace the content of an existing file (Drive keeps revision history). */
  updateContent(fileId: string, mime: string, data: Buffer): Promise<void>;
  folderUrl(id: string): string;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const clean = (s: string) => s.replace(/[\/\\]/g, "-").trim();

class LiveDrive implements DriveAdapter {
  mode = "live" as const;
  constructor(private d: drive_v3.Drive) {}

  async createRoot(name: string) {
    const r = await this.d.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, appProperties: { app: APP_TAG, kind: "root" } },
      fields: "id",
    });
    return r.data.id!;
  }

  async ensurePath(rootId: string, parts: string[]) {
    let parent = rootId;
    let logical = rootId;
    for (const raw of parts) {
      const name = clean(raw);
      logical = `${logical}/${name}`;
      const cached = await prisma.driveFolder.findUnique({ where: { path: logical } });
      if (cached) {
        parent = cached.folderId;
        continue;
      }
      const found = await this.d.files.list({
        q: `'${q(parent)}' in parents and name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: "files(id)",
        spaces: "drive",
      });
      let id = found.data.files?.[0]?.id;
      if (!id) {
        const r = await this.d.files.create({
          requestBody: { name, mimeType: FOLDER_MIME, parents: [parent], appProperties: { app: APP_TAG } },
          fields: "id",
        });
        id = r.data.id!;
      }
      await prisma.driveFolder.upsert({ where: { path: logical }, update: { folderId: id }, create: { path: logical, folderId: id } });
      parent = id;
    }
    return parent;
  }

  async upload(folderId: string, name: string, mime: string, data: Buffer, appKey: string) {
    const existing = await this.d.files.list({
      q: `'${q(folderId)}' in parents and appProperties has { key='key' and value='${q(appKey)}' } and trashed = false`,
      fields: "files(id)",
      spaces: "drive",
    });
    if (existing.data.files?.[0]?.id) return existing.data.files[0].id;
    const r = await this.d.files.create({
      requestBody: { name: clean(name), parents: [folderId], appProperties: { app: APP_TAG, key: appKey } },
      media: { mimeType: mime, body: Readable.from(data) },
      fields: "id",
    });
    return r.data.id!;
  }

  async updateContent(fileId: string, mime: string, data: Buffer) {
    await this.d.files.update({ fileId, media: { mimeType: mime, body: Readable.from(data) } });
  }

  folderUrl(id: string) {
    return `https://drive.google.com/drive/folders/${id}`;
  }
}

/** Local mock: mirrors the folder tree under ./mock-drive. Used only when Google is not connected. */
class MockDrive implements DriveAdapter {
  mode = "mock" as const;
  private dirOf(id: string) {
    return path.join(/*turbopackIgnore: true*/ MOCK_ROOT, id.replace(/^mock:/, ""));
  }
  async createRoot(name: string) {
    await fs.mkdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MOCK_ROOT, clean(name)), { recursive: true });
    return `mock:${clean(name)}`;
  }
  async ensurePath(rootId: string, parts: string[]) {
    const rel = path.join(/*turbopackIgnore: true*/ rootId.replace(/^mock:/, ""), ...parts.map(clean));
    await fs.mkdir(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MOCK_ROOT, rel), { recursive: true });
    return `mock:${rel}`;
  }
  async upload(folderId: string, name: string, _mime: string, data: Buffer, appKey: string) {
    const dir = this.dirOf(folderId);
    await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    const marker = path.join(/*turbopackIgnore: true*/ dir, `.${appKey.replace(/[^\w-]/g, "_")}`);
    try {
      return (await fs.readFile(/*turbopackIgnore: true*/ marker, "utf8")).trim();
    } catch {
      /* not uploaded yet */
    }
    const file = path.join(/*turbopackIgnore: true*/ dir, clean(name));
    await fs.writeFile(/*turbopackIgnore: true*/ file, data);
    const id = `mock:${path.relative(MOCK_ROOT, file)}`;
    await fs.writeFile(/*turbopackIgnore: true*/ marker, id);
    return id;
  }
  async updateContent(fileId: string, _mime: string, data: Buffer) {
    await fs.writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MOCK_ROOT, fileId.replace(/^mock:/, "")), data);
  }
  folderUrl(id: string) {
    return `mock://${id.replace(/^mock:/, "")}`;
  }
}

export async function getDrive(): Promise<DriveAdapter> {
  const auth = await authedClient();
  return auth ? new LiveDrive(google.drive({ version: "v3", auth })) : new MockDrive();
}
