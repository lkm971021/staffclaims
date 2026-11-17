import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageTitle, Alert } from "@/components/ui";
import { Flash } from "@/components/flash";
import { googleConfigured, googleMode } from "@/lib/google/auth";
import { disconnectGoogleAction, resyncAllAction, setCompanyDriveRootAction } from "@/app/actions/admin";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Google Drive & Sheets" };

export default async function GooglePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireRole("ADMIN");
  const [cred, mode, companies, sheet, archived, pending] = await Promise.all([
    prisma.googleCredential.findUnique({ where: { id: "default" } }),
    googleMode(),
    prisma.company.findMany({ orderBy: { name: "asc" } }),
    prisma.setting.findUnique({ where: { key: "masterSheetId:live" } }),
    prisma.claim.count({ where: { archiveStatus: "ARCHIVED", claimant: { isDemo: false } } }),
    prisma.claim.count({ where: { archiveStatus: { in: ["PENDING", "FAILED"] }, claimant: { isDemo: false } } }),
  ]);
  return (
    <AppShell user={u}>
      <PageTitle title="Google Drive & Sheets" />
      <Flash sp={await searchParams} />
      <div className="space-y-4">
        {mode === "live" ? (
          <Alert tone="green" title="LIVE — connected to Google">Signed in as <b>{cred?.email}</b> since {fmtDateTime(cred?.connectedAt)}. Access is limited to files this app creates (drive.file); your existing Drive files and templates cannot be read or changed by the app.</Alert>
        ) : (
          <Alert tone="amber" title="MOCK mode — not connected">Documents are archived to the server&apos;s local mock-drive folder only and the Master Listing is a local Excel file. Nothing is in Google yet.</Alert>
        )}
        <div className="card space-y-3 p-4 text-sm">
          <div className="font-semibold">Connection</div>
          {!googleConfigured() ? <div className="text-red-700">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on the server. See docs/GOOGLE_SETUP.md.</div> : null}
          <div className="flex flex-wrap gap-2">
            <a href="/api/google/connect" className="btn-primary btn-sm">{cred ? "Reconnect Google account" : "Connect Google account"}</a>
            {cred ? <form action={disconnectGoogleAction}><button className="btn-ghost btn-sm text-red-700">Disconnect</button></form> : null}
            <form action={resyncAllAction}><button className="btn-ghost btn-sm">Re-sync all claims to Drive & Sheets</button></form>
          </div>
          <div className="text-xs text-gray-500">Sign in with the Finance Google account that should own the claim files (e.g. the account that owns your accounting Drive). Archive status: {archived} archived · {pending} pending.</div>
        </div>
        <div className="card space-y-3 p-4 text-sm">
          <div className="font-semibold">Master Claim Listing (Google Sheet)</div>
          {sheet ? <a className="text-blue-700 underline" target="_blank" href={`https://docs.google.com/spreadsheets/d/${sheet.value as string}/edit`}>Open “Staff Claims - Master Claim Listing”</a> : <div className="text-gray-500">Created automatically on the first live sync, inside the holding company&apos;s root folder.</div>}
          <div className="text-xs text-gray-500">The sheet is a reporting copy written by the app. Edits made in the sheet are overwritten on the next sync — make changes in the app.</div>
        </div>
        <div className="card space-y-3 p-4 text-sm">
          <div className="font-semibold">Root folder per company</div>
          <div className="text-xs text-gray-500">Leave blank and the app creates “&lt;Company&gt; - STAFF EXPENSE CLAIMS (APP)” in My Drive on first use. You can then move that folder anywhere (e.g. into “5. CLAIMS”) — the app keeps working. Only folders created by this app can be used (drive.file security).</div>
          {companies.map((c) => (
            <form key={c.id} action={setCompanyDriveRootAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={c.id} />
              <span className="w-64 font-medium">{c.name}</span>
              <input name="driveRootId" defaultValue={c.driveRootId?.startsWith("mock:") ? "" : c.driveRootId ?? ""} placeholder="(auto-create)" className="input !w-80 !py-1.5 !text-sm" />
              <button className="btn-ghost btn-sm">Save</button>
              {c.driveRootId && !c.driveRootId.startsWith("mock:") ? <a className="text-xs text-blue-700 underline" target="_blank" href={`https://drive.google.com/drive/folders/${c.driveRootId}`}>open</a> : null}
            </form>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
