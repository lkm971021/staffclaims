import "server-only";
import { google } from "googleapis";
import { prisma } from "../db";
import { decrypt, encrypt } from "../crypto";

/**
 * Google Drive/Sheets access uses OAuth as the Finance Google account (a service account cannot
 * own files in a personal Gmail "My Drive"). Scope is drive.file: the app can only see and modify
 * files it created itself - your existing Drive files and the original template are untouchable.
 */
export const DRIVE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function oauthClient() {
  const base = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${base}/api/google/callback`);
}

export function consentUrl(state: string) {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: DRIVE_SCOPES, state, include_granted_scopes: true });
}

export async function saveConnection(code: string, userId: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove the app's access in your Google Account and connect again.");
  client.setCredentials(tokens);
  const info = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  await prisma.googleCredential.upsert({
    where: { id: "default" },
    update: { email: info.data.email ?? "", encryptedRefreshToken: encrypt(tokens.refresh_token), scopes: tokens.scope ?? "", connectedById: userId, connectedAt: new Date() },
    create: { email: info.data.email ?? "", encryptedRefreshToken: encrypt(tokens.refresh_token), scopes: tokens.scope ?? "", connectedById: userId },
  });
  return info.data.email;
}

/** Authorised client, or null when Google is not connected (=> mock mode). */
export async function authedClient() {
  if (!googleConfigured()) return null;
  const cred = await prisma.googleCredential.findUnique({ where: { id: "default" } });
  if (!cred) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(cred.encryptedRefreshToken) });
  return client;
}

export async function googleMode(): Promise<"live" | "mock"> {
  return (await authedClient()) ? "live" : "mock";
}
