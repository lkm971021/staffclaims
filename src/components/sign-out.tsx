"use client";
import { signOut } from "next-auth/react";
export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/login" })} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100">
      Sign out
    </button>
  );
}
