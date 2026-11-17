import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Chip } from "@/components/ui";
import { fmtDateTime, monthLabel, ymdOf } from "@/lib/time";
import { BatchEditor } from "./batch-editor";

export const metadata = { title: "Payment batch" };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole("FINANCE");
  const { id } = await params;
  const b = await prisma.paymentBatch.findUnique({
    where: { id },
    include: { company: true, items: { include: { claim: { include: { claimant: true } } }, orderBy: { claim: { ref: "asc" } } } },
  });
  if (!b) notFound();
  const s = await getSettings();
  const [creator, poster] = await Promise.all([
    prisma.user.findUnique({ where: { id: b.createdById } }),
    b.postedById ? prisma.user.findUnique({ where: { id: b.postedById } }) : null,
  ]);
  return (
    <AppShell user={u} wide>
      <Link href="/finance/payments" className="text-sm text-gray-500 hover:text-gray-900">← Payments</Link>
      <PageTitle
        title={`Payment batch ${b.ref}`}
        sub={<>{b.company.name} · created {fmtDateTime(b.createdAt)} by {creator?.name}{b.postedAt ? <> · marked paid {fmtDateTime(b.postedAt)} by {poster?.name}</> : null}</>}
        actions={
          <>
            <Chip tone={b.status === "POSTED" ? "green" : b.status === "DRAFT" ? "amber" : "gray"}>{b.status === "POSTED" ? "PAID" : b.status}</Chip>
            <a className="btn-ghost btn-sm" href={`/api/exports/payment?batch=${b.id}&format=xlsx`}>Excel</a>
            <a className="btn-ghost btn-sm" href={`/api/exports/payment?batch=${b.id}&format=pdf`} target="_blank">PDF listing</a>
          </>
        }
      />
      <BatchEditor
        batch={{
          id: b.id, ref: b.ref, status: b.status, paymentDate: ymdOf(b.paymentDate), method: b.method ?? "", bankRef: b.bankRef ?? "", remarks: b.remarks ?? "",
          proofName: b.proofDocName, proofDrive: Boolean(b.proofDriveFileId),
          items: b.items.map((i) => ({ claimId: i.claimId, ref: i.claim.ref, claimant: `${i.claim.claimant.employeeNo} · ${i.claim.claimant.name}`, month: monthLabel(i.claim.claimYear, i.claim.claimMonth), amountSen: i.amountSen, paymentRef: i.paymentRef ?? "" })),
        }}
        methods={s.reimbursementMethods}
      />
    </AppShell>
  );
}
