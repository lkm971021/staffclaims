import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/rbac";
import { googleLoginEnabled } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const u = await getCurrentUser();
  if (u) redirect(homeFor(u));
  const { error } = await searchParams;
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/icons/icon-192.png" alt="" className="mx-auto mb-3 h-14 w-14 rounded-2xl" />
          <h1 className="text-2xl font-bold">Staff Claims</h1>
          <p className="text-sm text-gray-500">Sign in to submit and track your expense claims</p>
        </div>
        <LoginForm google={googleLoginEnabled} error={error} />
        <p className="mt-6 text-center text-xs text-gray-400">Only accounts registered by the administrator can sign in.</p>
      </div>
    </div>
  );
}
