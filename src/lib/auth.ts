import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { audit } from "./audit";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
let _dummy: string | null = null;
const dummyHash = () => (_dummy ??= bcrypt.hashSync("not-a-real-password", 12));

export const googleLoginEnabled = Boolean(process.env.GOOGLE_LOGIN_CLIENT_ID && process.env.GOOGLE_LOGIN_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // 12 hours
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active || !user.passwordHash) {
          await bcrypt.compare(password, dummyHash()); // equalise timing for unknown accounts
          return null;
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) throw new Error("LOCKED");
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          const failed = user.failedLogins + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLogins: failed >= MAX_FAILED ? 0 : failed,
              lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
            },
          });
          if (failed >= MAX_FAILED) await audit(prisma, null, "User", user.id, "LOGIN_LOCKED");
          return null;
        }
        await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
        await audit(prisma, { id: user.id, name: user.name }, "User", user.id, "LOGIN_PASSWORD");
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
    ...(googleLoginEnabled
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_LOGIN_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET!,
            authorization: { params: { prompt: "select_account", scope: "openid email profile" } },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider !== "google") return true;
      const email = String(profile?.email ?? user.email ?? "").toLowerCase();
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
      if (!email || verified === false) return "/login?error=GoogleNotVerified";
      const dbUser = await prisma.user.findUnique({ where: { email } });
      // Only accounts registered by an administrator may sign in.
      if (!dbUser || !dbUser.active) return "/login?error=NotRegistered";
      if (dbUser.googleSub && dbUser.googleSub !== account.providerAccountId) return "/login?error=NotRegistered";
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { googleSub: account.providerAccountId, lastLoginAt: new Date() },
      });
      await audit(prisma, { id: dbUser.id, name: dbUser.name }, "User", dbUser.id, "LOGIN_GOOGLE");
      return true;
    },
    async jwt({ token, account, profile, user }) {
      if (account?.provider === "google") {
        const email = String(profile?.email ?? "").toLowerCase();
        const dbUser = await prisma.user.findUnique({ where: { email } });
        token.uid = dbUser?.id;
      } else if (user) {
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      (session as unknown as { uid?: string }).uid = token.uid as string | undefined;
      return session;
    },
  },
};
