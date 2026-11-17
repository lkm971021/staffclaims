"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";

const MESSAGES: Record<string, string> = {
  CredentialsSignin: "Incorrect email or password.",
  NotRegistered: "This Google account is not registered. Ask Finance / Admin to add your email.",
  GoogleNotVerified: "Your Google email is not verified.",
  LOCKED: "Too many failed attempts. Try again in 15 minutes.",
};

export function LoginForm({ google, error }: { google: boolean; error?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error ? MESSAGES[error] ?? "Sign-in failed." : "");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const fd = new FormData(e.currentTarget);
    const r = await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), redirect: false });
    if (r?.ok) window.location.href = "/";
    else {
      setErr(MESSAGES[r?.error ?? ""] ?? MESSAGES.CredentialsSignin);
      setBusy(false);
    }
  }
  return (
    <div className="card space-y-4 p-5">
      {google ? (
        <>
          <button type="button" onClick={() => signIn("google", { callbackUrl: "/" })} className="btn-ghost w-full py-3">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-xs text-gray-400"><div className="h-px flex-1 bg-gray-200" />or<div className="h-px flex-1 bg-gray-200" /></div>
        </>
      ) : null}
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div> : null}
        <button className="btn-primary w-full py-3" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
