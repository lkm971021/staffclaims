"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const p = usePathname();
  const active = p === href || (href !== "/" && p.startsWith(href + "/") && !["/finance"].includes(href));
  return (
    <Link href={href} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
      {children}
    </Link>
  );
}
