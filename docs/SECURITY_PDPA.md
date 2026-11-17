# Security, PDPA and data retention

## Controls in place

| Control | Implementation |
|---|---|
| Login | Google OAuth or bcrypt passwords. Only admin-registered accounts can sign in. An account locks for 15 minutes after 5 failed attempts. Sessions last 12 hours. Deactivation takes effect immediately |
| Role-based access | Checked on the server for every page, action and file. Staff see only their own claims. Team leaders see only claims of members they are assigned to. The Director sees claims only after Finance verification |
| Separation of duties | No self-verification and no self-approval. The Director cannot modify Finance records. Staff cannot edit after submission |
| Files | Kept in private server storage and in private Google Drive. **No public links.** Every download is permission-checked, served `no-store`, and logged for non-owners. File type is checked from the file content itself (photos and PDFs only, 15 MB limit) |
| Audit | Append-only `AuditLog`, `WorkflowEvent`, `ClaimVersion` and `Adjustment` tables. The **database rejects any update or delete** on them. Submitted claims cannot be deleted. Posted payment batches are locked |
| Secrets | Only in environment variables. The Google refresh token is stored encrypted (AES-256-GCM). Nothing is hard-coded |
| Integrity | Unique claim and batch references, idempotent submission (a double tap does not submit twice), retry-safe Drive and Sheets sync |
| Web | HTTPS (via your host), HSTS, `X-Frame-Options: SAMEORIGIN`, `nosniff`, strict CSP on file responses, camera access limited to the app itself |

## PDPA (Personal Data Protection Act 2010) notes

- **Personal data held:** staff name, employee ID, email, phone, NRIC, TIN, bank-transfer references, and receipt images (which may show third-party details).
- **Purpose:** processing expense reimbursements, plus accounting and tax record-keeping. Tell staff this in a short notice when onboarding (the Notice and Choice principle).
- **Third-party processors:** Google (Drive/Sheets, under your Google account) and, if OCR is enabled, Anthropic (receipt images are sent to the Claude API to read the receipt). Mention both in the staff notice. If you prefer not to send receipt images outside, leave `ANTHROPIC_API_KEY` unset; OCR is then switched off.
- **Access:** NRIC and TIN are visible only to the claimant, Finance and Admin. They are masked for team leaders and the Director.
- **Retention:** set in **Admin → Settings** (default 7 years). Nothing is deleted automatically. Review older records with your auditor or tax agent before any disposal.

## Items for you to confirm

- The staff privacy notice wording (PDPA).
- Whether OCR via an external AI service is acceptable under company policy.
- The retention period, with your tax agent or auditor.

## Known dependency advisories (at build time)

`npm audit` reports advisories only in components that do not handle user input:

| Component | Where it is used |
|---|---|
| `deepmerge-ts` | The Prisma command-line tool (development and migrations) |
| `minimatch` | Google's API client's internal cleanup helper |
| `uuid` | The Excel exporter's ID generator |

Other flagged packages (sharp, zod, archiver, googleapis, Next.js/PostCSS) were upgraded to fixed versions. Re-run `npm audit` when updating.
