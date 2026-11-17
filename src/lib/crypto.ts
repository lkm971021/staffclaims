import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** AES-256-GCM using TOKEN_ENCRYPTION_KEY (any long random string; hashed to 32 bytes). */
function key(): Buffer {
  const k = process.env.TOKEN_ENCRYPTION_KEY;
  if (!k || k.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY must be set (at least 32 characters).");
  return createHash("sha256").update(k).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
