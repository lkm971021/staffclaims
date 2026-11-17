# Google Cloud, Drive & Sheets setup

You only need to do this once (about 20 minutes). It switches the app from **MOCK mode** to **LIVE**.

## What the app can and cannot access

- The app signs in to Google **as your Finance Google account**, using OAuth.
  - A service account cannot be used here: your Drive is a personal Gmail "My Drive", and service accounts have no storage space in it.
- It asks for the **`drive.file`** permission only. That means:
  - It can see and change **only the files and folders it created itself**.
  - Your existing Drive, your claim template and other spreadsheets **cannot be read or modified** by the app.
- Claim files are **private**. The app never creates "anyone with the link" sharing.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>, signed in as the Finance Google account.
2. Click **Select project → New project**. Name it, for example, `staff-claims`, then **Create**.
3. Go to **APIs & Services → Library**. Enable:
   - **Google Drive API**
   - **Google Sheets API**

## 2. OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**. (In the new console this is **Google Auth Platform → Branding / Audience / Data access**.)
2. Choose User type **External**. Fill in:
   - App name: "Staff Claims"
   - Support email: your Finance email
   - Developer contact: your Finance email
3. Under **Data access / Scopes**, add:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/drive.file`
4. Under **Audience**, click **Publish app** so the status is **In production**.
   - **Important:** while the app is in *Testing*, Google expires the Drive connection every 7 days.
   - `drive.file` is a "non-sensitive" scope, so publishing does not need a Google security review.
   - Google may show an "unverified app" notice to the person connecting. Click **Advanced → Continue**. This is only shown to you, once.

## 3. Create the OAuth client

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `staff-claims-web`.
3. **Authorised redirect URIs**: add both of these, replacing `https://claims.example.com` with your app's address:
   - `https://claims.example.com/api/google/callback` (Drive and Sheets connection)
   - `https://claims.example.com/api/auth/callback/google` (staff "Sign in with Google")
4. Click **Create**, then copy the **Client ID** and **Client secret**.

## 4. Put the credentials on the server

In your hosting provider's environment-variable settings (never in the code):

```
GOOGLE_CLIENT_ID=...            # Drive + Sheets
GOOGLE_CLIENT_SECRET=...
GOOGLE_LOGIN_CLIENT_ID=...      # staff Google sign-in (can be the same client)
GOOGLE_LOGIN_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=...        # long random string - encrypts the stored Google refresh token
```

Then restart the app.

## 5. Connect

1. Sign in to the app as an **Administrator**.
2. Go to **Admin → Google Drive & Sheets → Connect Google account**.
3. Choose the Finance Google account and allow access.
4. The page should now show **LIVE — connected to Google**, and the orange MOCK banner disappears.

## 6. What happens next

On the first live archive, the app creates one root folder per company in your My Drive:

```
PLAN B PHYSIO SDN. BHD. - STAFF EXPENSE CLAIMS (APP)/
  2026/11. NOV/PJ MIDTOWN/00011. NG ZHU ER/CLM-2026-11-0001/
     01_Claim_Summary/  02_Original_Receipts/  03_Combined_PDF/(Enhanced_Images/)
     04_Additional_Supporting_Documents/  05_Approval_Records/
  PAYMENTS/2026/PAY-2026-11-001/   (payment proofs)
PLAN B PHYSIO SOUTH SDN. BHD. - STAFF EXPENSE CLAIMS (APP)/ ...
```

- You may **move these root folders anywhere** in your Drive (for example inside `Holding/Subsi › Branch › Expenses › Claims`). The app keeps working because it uses folder IDs, not names.
- The Google Sheet **"Staff Claims - Master Claim Listing"** is created in the holding company's root folder. It has the tabs `Master Register`, `Claims`, `Payments` and `Monthly Summary`.
  - It is a reporting copy. Edits made in the sheet are overwritten by the next sync.
- If any claims were archived in MOCK mode before you connected, click **Re-sync all claims to Drive & Sheets** once.
- **Demo/test accounts** (`…@example.test`) are archived to separate `DEMO TEST - …` folders and a separate `DEMO TEST` sheet, so they never mix with real records.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Google did not return a refresh token" | Go to <https://myaccount.google.com/permissions>, remove "Staff Claims", then connect again |
| Connection stops working after 7 days | The consent screen is still in *Testing*. Publish it (step 2.4), then reconnect |
| `redirect_uri_mismatch` | The redirect URI in step 3 must exactly match `NEXTAUTH_URL` + `/api/google/callback` |
| Claims stuck at "archiving" | Open **Admin → Sync jobs** to see the error, fix it, then click **Retry**. Claims never lose data because files are stored on the server first |
