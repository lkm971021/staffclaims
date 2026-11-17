#!/usr/bin/env bash
# Deploy / update Staff Claims on Google Cloud Run (Singapore) with files in Google Drive.
# Safe to re-run: every step checks what already exists.
#
#   PROJECT=my-gcp-project GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com ./deploy/gcp/deploy.sh
#
# Secret values are read from environment variables of the same name if set; otherwise you are
# prompted (input hidden). They are stored in Google Secret Manager, never in the code.
set -euo pipefail

PROJECT="${PROJECT:?Set PROJECT to your Google Cloud project id}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-staff-claims}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
cd "$(dirname "$0")/../.."

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

say "Project $PROJECT, region $REGION, service $SERVICE"
gcloud config set project "$PROJECT" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

say "Enabling APIs (first run takes a minute)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com drive.googleapis.com sheets.googleapis.com

ensure_secret() { # name, required(1/0)
  local name="$1" required="$2" value="${!1:-}"
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    if [ -z "$value" ]; then
      if [ "$required" = "0" ]; then echo "  (skipping optional secret $name)"; return 0; fi
      read -r -s -p "  Enter value for $name: " value; echo
    fi
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
    echo "  created secret $name"
  elif [ -n "$value" ]; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "  updated secret $name (new version)"
  else
    echo "  secret $name exists"
  fi
  gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
  SECRETS="${SECRETS:+$SECRETS,}${name}=${name}:latest"
}

say "Secrets"
SECRETS=""
# Generate the two random secrets automatically on first run
if ! gcloud secrets describe NEXTAUTH_SECRET >/dev/null 2>&1 && [ -z "${NEXTAUTH_SECRET:-}" ]; then NEXTAUTH_SECRET="$(openssl rand -base64 48)"; fi
if ! gcloud secrets describe TOKEN_ENCRYPTION_KEY >/dev/null 2>&1 && [ -z "${TOKEN_ENCRYPTION_KEY:-}" ]; then TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 48)"; fi
if ! gcloud secrets describe CRON_SECRET >/dev/null 2>&1 && [ -z "${CRON_SECRET:-}" ]; then CRON_SECRET="$(openssl rand -hex 32)"; fi
ensure_secret DATABASE_URL 1          # Neon connection string (see docs/DEPLOY_GOOGLE_CLOUD.md)
ensure_secret NEXTAUTH_SECRET 1
ensure_secret TOKEN_ENCRYPTION_KEY 1
ensure_secret CRON_SECRET 1
ensure_secret GOOGLE_CLIENT_SECRET 0  # add after creating the OAuth client
ensure_secret ANTHROPIC_API_KEY 0     # optional: receipt OCR
ensure_secret SMTP_PASSWORD 0         # optional: email notifications

ENV_VARS="STORAGE_BACKEND=drive,TZ=Asia/Kuala_Lumpur,NEXT_TELEMETRY_DISABLED=1"
[ -n "$GOOGLE_CLIENT_ID" ] && ENV_VARS="$ENV_VARS,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
[ -n "${SMTP_HOST:-}" ] && ENV_VARS="$ENV_VARS,SMTP_HOST=$SMTP_HOST,SMTP_PORT=${SMTP_PORT:-587},SMTP_USER=${SMTP_USER:-},SMTP_FROM=${SMTP_FROM:-}"
EXISTING_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"
[ -n "$EXISTING_URL" ] && ENV_VARS="$ENV_VARS,NEXTAUTH_URL=$EXISTING_URL,APP_URL=$EXISTING_URL"

say "Building and deploying (Cloud Build -> Cloud Run). This takes 5-10 minutes."
gcloud run deploy "$SERVICE" --source . --region "$REGION" --allow-unauthenticated \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 2 --concurrency 40 --timeout 300 \
  --set-env-vars "$ENV_VARS" --set-secrets "$SECRETS" --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
if [ "$URL" != "$EXISTING_URL" ]; then
  say "First deploy: setting the app's public URL ($URL)"
  gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "NEXTAUTH_URL=$URL,APP_URL=$URL" --quiet
fi

say "Background jobs schedule (Cloud Scheduler -> /api/cron)"
CRON_VALUE="$(gcloud secrets versions access latest --secret=CRON_SECRET)"
upsert_job() { # name, schedule
  local args=(--location "$REGION" --schedule "$2" --time-zone "Asia/Kuala_Lumpur" --uri "$URL/api/cron"
    --http-method POST --headers "Authorization=Bearer ${CRON_VALUE}" --attempt-deadline 300s)
  if gcloud scheduler jobs describe "$1" --location "$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$1" "${args[@]}" >/dev/null
  else
    gcloud scheduler jobs create http "$1" "${args[@]}" >/dev/null
  fi
  echo "  $1: $2"
}
# Every 15 min in the day, hourly at night: keeps the free Neon database asleep most of the night.
upsert_job staff-claims-day "*/15 7-22 * * *"
upsert_job staff-claims-night "0 0-6,23 * * *"

say "Keeping only the 2 newest container images (Artifact Registry free tier is 0.5 GB)"
cat > /tmp/staff-claims-cleanup.json <<'JSON'
[{"name":"keep-2-newest","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":2}},
 {"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"7d"}}]
JSON
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy --location "$REGION" \
  --policy /tmp/staff-claims-cleanup.json --no-dry-run >/dev/null 2>&1 || echo "  (cleanup policy not applied - set it in the console if needed)"

say "Done. App URL: $URL"
cat <<NEXT
Next steps (first deploy only) - see docs/DEPLOY_GOOGLE_CLOUD.md:
  1. OAuth client redirect URIs:  $URL/api/google/callback   and   $URL/api/auth/callback/google
  2. Re-run with GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... to store them
  3. Create your admin:  DATABASE_URL='<neon url>' ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_EMPLOYEE_NO=... ADMIN_ROLES=ADMIN,FINANCE,STAFF npm run create-admin
  4. Sign in at $URL -> Admin -> Google Drive & Sheets -> Connect
NEXT
