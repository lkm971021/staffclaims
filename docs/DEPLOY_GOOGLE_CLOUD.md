# Deploying on Google Cloud (Cloud Run + Neon + Google Drive storage)

This set-up has no servers to maintain and costs **close to nothing** at your size.

| Piece | Service | Expected cost |
|---|---|---|
| Web app | Cloud Run, Singapore (`asia-southeast1`), scales to zero when idle | Within the free tier: 2M requests and 180k vCPU-seconds per month |
| Background jobs | Cloud Scheduler calls `/api/cron`: every 15 min 07:00–22:59 MYT, hourly overnight | Free (3 jobs per billing account) |
| Database | **Neon** Postgres, free plan, Singapore region | Free (about 0.5–1 GB storage, about 100 compute-hours per month) |
| Files | **Your Google Drive** (`STORAGE_BACKEND=drive`) | Free, uses your Drive quota |
| Secrets | Secret Manager | Free for up to 6 secrets; about USD 0.06 per month for each extra |
| Container image | Artifact Registry (only the 2 newest kept) | Free up to 0.5 GB, a few cents per month above that |
| Database backups | The app's own daily export to your Drive (35 kept) | Free |

Notes:
- Free tiers are set by Google and Neon and can change. Check their pricing pages once a year.
- A **billing account (card)** is required by Google Cloud even for free-tier use. Set a **budget alert** (step 1.4).

## How it fits together

- **Files:** staff uploads go straight into a private Drive folder, "STAFF CLAIMS APP - FILE STORE". Once a claim is archived, they are **moved** into the claim folder (`… - STAFF EXPENSE CLAIMS (APP)/2026/11. NOV/…`). Nothing is kept on the Cloud Run server.
- **If Google is not connected, uploads are refused** with a clear message. Files are never put on a temporary disk.
- **Background jobs** (archive to Drive, Master Listing sheet, emails, reminders, daily backup) run when Cloud Scheduler calls the app. Archive and Sheet updates therefore appear within about 15 minutes in the daytime. In-app notifications are instant.
- **Waking up:** the first page after a quiet period can take about 5–10 seconds while Cloud Run and Neon wake up. After that it is fast.

## 1. Google Cloud project (once)

1. Go to <https://console.cloud.google.com>, signed in as the **Finance Google account** that will own the claim files.
2. Create a project, for example `staff-claims` (top bar → project picker → **New project**).
3. **Billing → Link a billing account** (add a card).
4. **Billing → Budgets & alerts → Create budget**, for example USD 5 per month, with email alerts at 50%, 90% and 100%.
5. Open **Cloud Shell**: the `>_` icon at the top right. Everything below runs there.

## 2. Database: Neon (once)

1. Sign up at <https://neon.com> and create a project:
   - Region: **AWS Asia Pacific (Singapore)**. The region cannot be changed later.
   - Postgres version: 16 or newer.
2. **Connect →** copy the connection string. Use the **direct (non-pooled)** host and add `&connection_limit=5` to the end. For example:
   `postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connection_limit=5`
3. Notes:
   - The free plan pauses the database when idle; the app wakes it automatically.
   - Neon may delete free projects that have been **inactive for 90 days**. Daily use keeps it active, and the app's own daily backups are in your Drive in any case.

## 3. Deploy (Cloud Shell)

```bash
git clone https://github.com/lkm971021/staffclaims.git
```

```bash
cd staffclaims && npm ci
```

```bash
PROJECT=your-project-id ./deploy/gcp/deploy.sh
```

The script:
- enables the APIs
- asks for `DATABASE_URL` (paste the Neon string; the input is hidden)
- generates the other secrets
- builds and deploys to Cloud Run
- sets up the two schedules
- prints your app URL, like `https://staff-claims-xxxx.asia-southeast1.run.app`

Then create the tables and your administrator account. Run these from Cloud Shell, in the `staffclaims` folder:

```bash
export DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL)"
```

```bash
npx prisma migrate deploy && npm run db:seed
```

```bash
ADMIN_EMAIL=you@example.com ADMIN_NAME="YOUR FULL NAME" ADMIN_EMPLOYEE_NO=00001 ADMIN_ROLES=ADMIN,FINANCE,STAFF ADMIN_PASSWORD='a-long-password' npm run create-admin
```

(The container also applies database migrations automatically every time it starts.)

## 4. Google OAuth client (once)

Follow `docs/GOOGLE_SETUP.md` steps 2–3, using your Cloud Run URL for the two redirect URIs:

- `https://<your-app-url>/api/google/callback`
- `https://<your-app-url>/api/auth/callback/google`

Then store the client ID and secret by re-running the script:

```bash
PROJECT=your-project-id GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=xxxx ./deploy/gcp/deploy.sh
```

One OAuth client serves both Drive access and staff "Sign in with Google".

## 5. Connect Google Drive

1. Open the app URL and sign in as the administrator.
2. Go to **Admin → Google Drive & Sheets → Connect Google account**, and choose the Finance Google account.
3. Check that the page says **LIVE** and "Files are stored directly in Google Drive".
4. Click **Back up database now** once to confirm backups work.

Uploads only work after this step.

## 6. Optional extras

| Feature | How to turn it on |
|---|---|
| OCR | Re-run the script with `ANTHROPIC_API_KEY=sk-ant-...` |
| Email | Re-run with `SMTP_HOST=smtp.gmail.com SMTP_USER=... SMTP_FROM="Staff Claims <...>" SMTP_PASSWORD=<Gmail app password>` |
| Custom domain | Cloud Run → your service → **Manage custom domains**. Afterwards, update the OAuth redirect URIs and re-run the script (it picks up the new URL) |

## Updating the app later

```bash
cd staffclaims && git pull && PROJECT=your-project-id ./deploy/gcp/deploy.sh
```

## Restoring the database from a backup

1. Download the newest `staff-claims-db-….json.gz` from the Drive folder "STAFF CLAIMS APP - DATABASE BACKUPS".
2. Create a new, empty Neon database and run `npx prisma migrate deploy` against it.
3. Run `npx tsx scripts/restore-backup.ts <file>`.
4. Point the `DATABASE_URL` secret at the new database and re-run the deploy script.

Receipts and PDFs are not inside the backup; they stay in Google Drive and are linked by ID.

## Limits to know

- Cloud Run is limited to 2 instances (`--max-instances 2`) to cap cost. That is ample for your staff numbers.
- Neon free: about 0.5–1 GB of data, which is many years of claims (receipt images live in Drive, not the database).
- If the Finance Google account's Drive becomes full, uploads fail. Watch the Drive quota.

> **Status:** the deploy script and Cloud Run configuration are written and syntax-checked, but **were not run against a real Google Cloud project** during development (no project access). Drive-as-storage is fully tested against the mock Drive (`tests/integration/drive-storage.test.ts`). Do the first deployment together with the pilot test in `TESTING_CHECKLIST.md`.
