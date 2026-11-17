# Staff Expense Claims

A mobile-first claims app (installable as a phone app, i.e. a PWA) for **Plan B Physio Sdn. Bhd. and Plan B Physio South Sdn. Bhd.** It covers the whole claim lifecycle:
- Staff photograph their receipts and submit claims from their phones.
- Finance verifies each expense line.
- The Service Director approves.
- Finance records payment.

Every claim is filed automatically to **Google Drive** and listed in a **Google Sheets** Master Claim Listing.

| | |
|---|---|
| Time zone / currency | Asia/Kuala_Lumpur · MYR (money stored as integer sen) |
| Stack | Next.js 16 (App Router, TypeScript) · PostgreSQL 16 + Prisma · Tailwind · pdf-lib · sharp · googleapis · Claude vision OCR |
| Roles | Staff (incl. team leaders) · Finance · Service Director · Administrator |

## Status of each part (as at 17 Nov 2026)

| Area | Status |
|---|---|
| Staff app: dashboard, claim form, camera/gallery/PDF upload, crop / perspective / enhance, combined PDF, drafts, submit, history | **Working**. Tested in headless Chromium emulating iPhone 13 and Pixel 7. Not yet tested on a physical phone. |
| Finance verification workspace, line-level and partial verification, adjustments, duplicate review, return / reject | **Working** and tested |
| Director approval queue and review | **Working** and tested |
| Payment batches (`PAY-YYYY-MM-NNN`), double-payment protection, payment listing | **Working** and tested |
| Reports (8 required + accounting export) in Excel / CSV / PDF, ZIP downloads, reconciliation checks, management charts | **Working** and tested |
| Audit trail: append-only, enforced by the database | **Working** and tested |
| Notifications (in-app) and reminders | **Working** |
| Email notifications | Built. **Not tested.** Needs your SMTP details. |
| **Google Drive archive and Google Sheets Master Listing** | Built and fully tested in **MOCK mode** (local folder + local `.xlsx`). **Live Google not yet tested.** It needs your Google Cloud OAuth client; see `docs/GOOGLE_SETUP.md`. |
| **Receipt OCR (Claude vision)** | Built. **Not tested live.** Needs `ANTHROPIC_API_KEY`. Without a key, OCR switches off and the form works normally. |
| Google sign-in | Built. **Not tested live.** Needs an OAuth client. Email + password sign-in is tested. |
| **Google Drive as the main file store** (`STORAGE_BACKEND=drive`, for Cloud Run) | Built and tested against the mock Drive: uploads go to Drive, are moved (not copied) on archive, and the app refuses to store files if Google is not connected. **Not yet run against live Drive.** |
| Daily database backup to Drive, plus restore script | Built and tested: backup, then restore into a new database, then all tables compared |
| Google Cloud Run deployment (`deploy/gcp/deploy.sh`) | Written and syntax-checked. **Not yet run against a real Google Cloud project.** |

The app shows a **MOCK MODE** banner to Finance and Admin until Google is connected.

## Quick start (local)

```bash
cp .env.example .env          # fill in DATABASE_URL, NEXTAUTH_*, TOKEN_ENCRYPTION_KEY
npm ci
npx prisma migrate deploy     # create tables (+ append-only audit triggers)
npm run db:seed               # companies, branches, 35 categories, settings (reference data only)
npm run db:seed:demo          # OPTIONAL: DEMO users (…@example.test) for testing - never real data
npm run build && npm start    # web app on :3000
npm run worker                # second process: Drive/Sheets/email jobs + reminders
```

Create your real first administrator:

```bash
ADMIN_EMAIL=you@example.com ADMIN_NAME="YOUR FULL NAME" ADMIN_EMPLOYEE_NO=00001 \
ADMIN_ROLES=ADMIN,FINANCE,STAFF ADMIN_PASSWORD='choose-a-long-password' npm run create-admin
```

## Tests

```bash
npm test                      # unit + integration (needs a test Postgres DB, see vitest.config.ts)
node tests/e2e/staff-mobile.mjs        # browser walk-through (server running, demo data seeded)
node tests/e2e/finance-director.mjs
node tests/e2e/security-smoke.mjs      # 44 access-control & smoke checks
```

## Documentation

| Document | For |
|---|---|
| `docs/PHASE1_ANALYSIS.md` | Template analysis, architecture, schema, permissions, workflow, open business rules |
| `docs/GOOGLE_SETUP.md` | Google Cloud, OAuth, Drive and Sheets connection (step by step) |
| `docs/DEPLOY_GOOGLE_CLOUD.md` | **Chosen hosting:** Cloud Run + Neon + Google Drive storage, step by step |
| `docs/DEPLOYMENT.md` | Other hosting options, environment variables, backups, updates |
| `docs/ADMIN_GUIDE.md` | First admin, adding staff, team leaders, categories, deadlines, e-Invoice settings |
| `docs/STAFF_GUIDE.md` | How staff submit claims on their phone |
| `docs/FINANCE_GUIDE.md` | Verification, duplicates, payments, reports, month-end |
| `docs/DIRECTOR_GUIDE.md` | Approving claims |
| `docs/TESTING_CHECKLIST.md` | Acceptance tests: what is verified and what you still need to test |
| `docs/SECURITY_PDPA.md` | Security controls, PDPA, retention, backups, known dependency advisories |

## Project layout

```
prisma/            schema, migrations (incl. audit triggers), seed scripts
src/lib/           business logic: workflow, claims, review/payments, duplicates, OCR, PDFs, Google, reports
src/app/           pages (staff, finance, director, management, admin) + API routes
src/components/    UI, receipt capture editor, document viewer, charts
src/worker/        background worker entry point
tests/             unit, integration (real DB) and browser E2E scripts
```
