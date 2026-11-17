import "server-only";
import { ZipArchive } from "archiver";
import { PassThrough, Readable } from "stream";
import { prisma } from "./db";
import { getFile } from "./storage";
import { SUBFOLDERS, buildSupportingPdf } from "./archive";
import { driveMonthFolder } from "./time";
import { audit } from "./audit";
import type { SessionUser } from "./rbac";

const folderFor: Record<string, string> = {
  ORIGINAL: SUBFOLDERS.originals, ENHANCED: SUBFOLDERS.enhanced, COMBINED_PDF: SUBFOLDERS.combined, CLAIM_SUPPORTING_PDF: SUBFOLDERS.combined,
  CLAIM_SUMMARY: SUBFOLDERS.summary, APPROVAL_RECORD: SUBFOLDERS.approval, ADDITIONAL: SUBFOLDERS.additional, PAYMENT_PROOF: SUBFOLDERS.approval,
};
const clean = (s: string) => s.replace(/[\/\\:*?"<>|]/g, "-").trim();

/** Stream a ZIP of the given claims' documents, laid out like the Google Drive archive. */
export async function zipClaims(u: SessionUser, claimIds: string[], name: string, extra: { name: string; data: Buffer }[] = []) {
  const zip = new ZipArchive({ zlib: { level: 6 } });
  const out = new PassThrough();
  zip.pipe(out);
  (async () => {
    try {
      for (const f of extra) zip.append(f.data, { name: f.name });
      for (const id of claimIds) {
        const c = await prisma.claim.findUniqueOrThrow({ where: { id }, include: { claimant: { include: { branch: true } }, lines: true, documents: { where: { removedAt: null } } } });
        const base = [String(c.claimYear), driveMonthFolder(c.claimMonth), clean(c.claimant.branch?.name ?? "NO BRANCH"), clean(`${c.claimant.employeeNo}. ${c.claimant.name}`), c.ref].join("/");
        const lineNo = new Map(c.lines.map((l) => [l.id, l.lineNo]));
        for (const d of c.documents) {
          const prefix = d.lineId ? `L${String(lineNo.get(d.lineId) ?? 0).padStart(2, "0")}-` : "";
          zip.append(await getFile(d.storageKey), { name: `${base}/${folderFor[d.kind] ?? "99_Other"}/${d.supersededAt ? "SUPERSEDED-" : ""}${prefix}${clean(d.filename)}`, date: d.uploadedAt });
        }
        if (!c.documents.some((d) => d.kind === "CLAIM_SUPPORTING_PDF" && d.version === c.version)) {
          zip.append(await buildSupportingPdf(c.id), { name: `${base}/${SUBFOLDERS.combined}/${c.ref} - Supporting Documents (current).pdf` });
        }
      }
      await audit(prisma, { id: u.id, name: u.name }, "Export", name, "DOWNLOAD_ZIP", undefined, { claims: claimIds.length });
      await zip.finalize();
    } catch (e) {
      console.error("[zip]", e);
      zip.abort();
      out.destroy(e as Error);
    }
  })();
  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${clean(name)}.zip"`, "Cache-Control": "private, no-store" },
  });
}
