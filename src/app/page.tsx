import { redirect } from "next/navigation";
import { requireUser, homeFor } from "@/lib/rbac";
export default async function Home() {
  const u = await requireUser();
  redirect(homeFor(u));
}
