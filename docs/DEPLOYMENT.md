# Deployment

The app is two processes plus a PostgreSQL database and a persistent folder for files:

- **web**: `npx prisma migrate deploy && npx next start` (the Docker image does this automatically)
- **worker**: `npm run worker`. Handles Drive and Sheets uploads, emails and reminders. If your host cannot run a second process, schedule `POST /api/cron` every 1–5 minutes with the header `Authorization: Bearer $CRON_SECRET` instead.
- **PostgreSQL 16+**
- **Persistent storage** at `STORAGE_DIR`. This holds the private copies of every upload. **Without a persistent volume, files are lost on redeploy.**

## Option A: Railway or Render (recommended: least maintenance)

1. Push the code to a **private** GitHub repository.
2. Create a new project from the repo (Dockerfile build).
3. Add a **PostgreSQL** database and copy its URL into `DATABASE_URL`.
4. Add a **Volume** mounted at `/data/storage` and set `STORAGE_DIR=/data/storage`.
5. Set the environment variables from `.env.example` (see the table below).
6. Add a second service from the same repo, with start command `npm run worker` and the same variables and volume.
   - If the platform cannot share the volume between two services, use the cron option instead (Render Cron Job, or a scheduled HTTP call).
7. Attach your domain, for example `claims.yourcompany.com`, with HTTPS (automatic).
8. Run the `create-admin` command once (see `docs/ADMIN_GUIDE.md`).

Typical cost: about USD 10–25 per month.

## Option B (chosen): Google Cloud Run + Neon + Google Drive file storage

See **`docs/DEPLOY_GOOGLE_CLOUD.md`** for the full step-by-step guide and the `deploy/gcp/deploy.sh` script.

## Option B2: Google Cloud Run + Cloud SQL

- Build the Dockerfile and deploy to Cloud Run (region `asia-southeast1`).
- Use Cloud SQL Postgres, connected via the Cloud SQL connector.
- **Cloud Run has no persistent disk.** Mount a Cloud Storage bucket with Cloud Run volume mounts (gcsfuse) at `/data/storage`.
- Run the worker as a second Cloud Run service with min instances = 1, or use Cloud Scheduler to call `/api/cron` every 2 minutes.

## Option C: a single VPS (cheapest; you manage it)

```bash
git clone <your private repo> && cd staff-claims
cp .env.example .env    # fill in, plus POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec web sh -c 'ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_EMPLOYEE_NO=... ADMIN_ROLES=ADMIN,FINANCE,STAFF ADMIN_PASSWORD=... npm run create-admin'
```

Put Caddy or nginx in front of port 3000 for HTTPS.

> The Dockerfile and compose file were written but **not built in the development environment** (no Docker daemon was available). Build them once on your host and check `docker compose logs`.

## Option D: free hosting (Oracle Cloud Always Free VM)

This is the only free option that meets all of the app's needs: a persistent disk for files, a database, and an always-on worker. It is Option C (`docker compose`) on a free virtual machine.

1. Sign up at oracle.com/cloud/free. A payment card is needed for identity checks. Choose the **Singapore** home region; it cannot be changed later.
2. Create an **Ampere A1** instance (Ubuntu) within the Always Free limit. As of Oct 2026 that is **2 OCPU / 12 GB RAM**, with up to 200 GB of disk shared by all volumes.
3. Install Docker, then follow Option C. Point a domain or free subdomain at the VM's public IP, and use Caddy for automatic HTTPS.
4. Back up yourself. There are no managed backups. Schedule a nightly database dump (`docker compose exec db pg_dump`) and keep the files volume copied somewhere off the VM.

Caveats:
- There is no uptime guarantee or support.
- Oracle has changed the free limits before (it halved them in 2026).
- Oracle may reclaim Always Free instances it considers idle.

Keep the paid options in mind once the app is business-critical.

**Free options considered and rejected:**

| Option | Why not |
|---|---|
| Render free | Web service sleeps after 15 minutes. Free Postgres is deleted 30 days after creation. No backups. No persistent disk |
| Vercel Hobby | Non-commercial use only. No background worker or disk |
| Supabase / Neon free | Database only (about 0.5–1 GB). They still need a host for the app and files. Can be combined with Option D if preferred |
| Google Cloud e2-micro | Only 1 GB RAM, and only in US regions |

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `NEXTAUTH_URL`, `APP_URL` | yes | Public https URL, no trailing slash |
| `NEXTAUTH_SECRET` | yes | `openssl rand -base64 48` |
| `TOKEN_ENCRYPTION_KEY` | yes | `openssl rand -base64 48`. **Keep it safe:** changing it means reconnecting Google |
| `STORAGE_DIR` | yes | Persistent volume path |
| `GOOGLE_CLIENT_ID` / `_SECRET` | for live Drive/Sheets | See `GOOGLE_SETUP.md` |
| `GOOGLE_LOGIN_CLIENT_ID` / `_SECRET` | for Google sign-in | Can be the same client |
| `ANTHROPIC_API_KEY` | for OCR | From console.anthropic.com. Optional: `OCR_MODEL`, `OCR_EFFORT` |
| `SMTP_*` | for email | Gmail: smtp.gmail.com, port 587, with an App Password |
| `CRON_SECRET` | if no worker | Long random string |
| `PDF_CJK_FONT` | optional | A single-font `.otf`/`.ttf` (for example NotoSansSC-Regular.otf) so Chinese text prints in PDFs. Without it, Chinese characters print as "?" in generated PDFs only; the data itself is stored correctly |

## Backups and recovery

- **Database:** enable daily automated backups with at least 30 days' retention (Railway, Render and Cloud SQL all offer this). Test a restore once a quarter.
- **Files** (`STORAGE_DIR`): include the volume in backups. Every archived file is also in Google Drive, which is your second copy.
- **Recovery:**
  1. Restore the database and the files volume.
  2. Redeploy.
  3. If needed, click **Admin → Google → Re-sync all claims**. The sync is safe to repeat: it never creates duplicate files or rows.

## Updating the app

1. Push the new code. The web container runs `prisma migrate deploy` on start.
2. Check **Admin → Sync jobs** afterwards for any failures.
