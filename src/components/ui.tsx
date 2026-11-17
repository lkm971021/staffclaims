import type { ClaimStatus } from "@prisma/client";
import Link from "next/link";
import { STATUS_SHORT, STATUS_TONE, STATUS_LABEL } from "@/lib/workflow";
import { rm } from "@/lib/money";

const TONES: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-800",
  violet: "bg-violet-50 text-violet-700",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  teal: "bg-teal-50 text-teal-700",
};

export function StatusBadge({ status, long }: { status: ClaimStatus; long?: boolean }) {
  return <span className={`chip ${TONES[STATUS_TONE[status]]}`} title={STATUS_LABEL[status]}>{long ? STATUS_LABEL[status] : STATUS_SHORT[status]}</span>;
}

export function Chip({ tone = "gray", children }: { tone?: keyof typeof TONES | string; children: React.ReactNode }) {
  return <span className={`chip ${TONES[tone] ?? TONES.gray}`}>{children}</span>;
}

export function Money({ sen, className = "" }: { sen: number | null | undefined; className?: string }) {
  return <span className={`num ${className}`}>{rm(sen)}</span>;
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: string }) {
  const body = (
    <div className={`card h-full p-4 ${href ? "transition hover:border-gray-400" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-bold num ${tone ?? ""}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-gray-500">{sub}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {sub ? <div className="mt-0.5 text-sm text-gray-500">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">{children}</div>;
}

export function Alert({ tone = "amber", title, children }: { tone?: "amber" | "red" | "blue" | "green"; title?: string; children?: React.ReactNode }) {
  const c = { amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-900", blue: "border-blue-200 bg-blue-50 text-blue-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${c}`}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children}
    </div>
  );
}
