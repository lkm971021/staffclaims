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
  /** Download a file's bytes. */
  download(fileId: string): Promise<Buffer>;
  /** Move (and rename) a file into another folder. Returns the file id (unchanged on live Drive). */
  move(fileId: string, folderId: string, name: string): Promise<string>;
  /** Files directly inside a folder (only files this app created are visible). */
  list(folderId: string): Promise<{ id: string; name: string; createdTime: string }[]>;
  /** Move a file to the Drive bin (recoverable for 30 days). */
  trash(fileId: string): Promise<void>;
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

  async download(fileId: string) {
    const r = await this.d.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(r.data as ArrayBuffer);
  }

  async move(fileId: string, folderId: string, name: string) {
    const f = await this.d.files.get({ fileId, fields: "parents" });
    const from = (f.data.parents ?? []).filter((p) => p !== folderId).join(",");
    await this.d.files.update({ fileId, addParents: folderId, removeParents: from || undefined, requestBody: { name: clean(name) }, fields: "id" });
    return fileId;
  }

  async list(folderId: string) {
    const out: { id: string; name: string; createdTime: string }[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.d.files.list({
        q: `'${q(folderId)}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, createdTime)",
        spaces: "drive",
        pageSize: 1000,
        pageToken,
      });
      for (const f of r.data.files ?? []) out.push({ id: f.id!, name: f.name ?? "", createdTime: f.createdTime ?? "" });
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  async trash(fileId: string) {
    await this.d.files.update({ fileId, requestBody: { trashed: true } });
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
  async download(fileId: string) {
    return fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MOCK_ROOT, fileId.replace(/^mock:/, "")));
  }
  async move(fileId: string, folderId: string, name: string) {
    const from = path.join(/*turbopackIgnore: true*/ MOCK_ROOT, fileId.replace(/^mock:/, ""));
    const dir = this.dirOf(folderId);
    await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    let to = path.join(/*turbopackIgnore: true*/ dir, clean(name));
    if (to !== from) {
      try {
        await fs.access(/*turbopackIgnore: true*/ to);
        to = path.join(/*turbopackIgnore: true*/ dir, `${Date.now()}-${clean(name)}`); // mimic Drive allowing same names
      } catch {
        /* free */
      }
      await fs.rename(/*turbopackIgnore: true*/ from, to);
    }
    return `mock:${path.relative(MOCK_ROOT, to)}`;
  }
  async list(folderId: string) {
    const dir = this.dirOf(folderId);
    const names = await fs.readdir(/*turbopackIgnore: true*/ dir).catch(() => [] as string[]);
    const out: { id: string; name: string; createdTime: string }[] = [];
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const st = await fs.stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, n));
      if (st.isFile()) out.push({ id: `mock:${path.relative(MOCK_ROOT, path.join(dir, n))}`, name: n, createdTime: st.birthtime.toISOString() });
    }
    return out;
  }
  async trash(fileId: string) {
    await fs.rm(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ MOCK_ROOT, fileId.replace(/^mock:/, "")), { force: true });
  }
  folderUrl(id: string) {
    return `mock://${id.replace(/^mock:/, "")}`;
  }
}

export async function getDrive(): Promise<DriveAdapter> {
  const auth = await authedClient();
  return auth ? new LiveDrive(google.drive({ version: "v3", auth })) : new MockDrive();
}
