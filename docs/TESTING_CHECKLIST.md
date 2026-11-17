# Acceptance testing checklist

Legend:
- ✅ verified automatically during development (unit/integration tests against PostgreSQL, or browser tests in headless Chromium)
- 🟡 built, but **needs your live test**: real phones, real Google, a real OCR key
- ☐ yours to tick

| # | Your acceptance criterion | Development result | How it was verified | Your live test |
|---|---|---|---|---|
| 1 | Staff submit a claim on a mobile phone | ✅ / 🟡 | Browser test emulating iPhone 13 and Pixel 7 (`tests/e2e/staff-mobile.mjs`) | ☐ Submit from one real iPhone and one real Android using **Take photo** |
| 2 | Receipts photographed and converted to readable PDFs | ✅ / 🟡 | Crop/enhance editor tested in the browser. Combined PDF generated and inspected | ☐ Check a real thermal receipt's PDF is readable |
| 3 | Original documents preserved | ✅ | Original stored byte-for-byte; the enhanced copy is stored separately. Superseded files kept | |
| 4 | Claim data saved correctly | ✅ | Integration tests | |
| 5 | Staff cannot access other employees' records | ✅ | 44-check access test (`tests/e2e/security-smoke.mjs`): documents, PDFs, ZIP, pages and exports all refused | ☐ Try opening a colleague's claim link |
| 6 | Finance can verify each expense and document | ✅ | Workspace browser test and integration tests | |
| 7 | Possible duplicates flagged | ✅ | Same file, same supplier + receipt no., same supplier + date + amount (across staff). Also OCR-read receipt no. + total, once OCR is enabled | ☐ Re-submit an old receipt |
| 8 | Finance can return claims | ✅ | Return → correct → resubmit as v2; v1 kept | |
| 9 | Only Finance-verified claims reach the Director | ✅ | Workflow tests | |
| 10 | Only Director-approved claims reach payment | ✅ | Workflow tests | |
| 11 | Payments recorded, no double payment | ✅ | Unique claim per batch + database lock on posted batches (tested) | |
| 12 | Google Drive folders and documents saved correctly | ✅ mock / 🟡 live | Folder tree, 01–05 subfolders and file names verified in mock mode | ☐ After connecting Google: submit a claim, check the Drive folder |
| 13 | Google Sheets sync works | ✅ mock / 🟡 live | Upsert without duplicate rows verified on the mock workbook | ☐ Check the Master Listing tabs after a claim is paid |
| 14 | Historical records and audit logs retrievable | ✅ | History pages, year filters, audit log; append-only enforced by DB triggers (tested) | |
| 15 | No re-entering the same information | ✅ | One entry by staff flows to the PDF, Drive, Sheet, reports and the accounting export | |
| – | OCR suggestions | 🟡 | Code path built; **not called live** (no API key in development) | ☐ Set `ANTHROPIC_API_KEY`, upload a receipt, check the suggested fields |
| – | Email notifications | 🟡 | Not tested (no SMTP in development) | ☐ Set `SMTP_*`, submit a claim, check that Finance receives an email |
| – | Google sign-in | 🟡 | Not tested live | ☐ Sign in with a staff Gmail |
| – | Docker build | 🟡 | Not built in development (no Docker daemon) | ☐ `docker compose up --build` |

## Suggested pilot (before go-live)

1. Use 2–3 real staff for one month's claims.
2. Run the whole cycle, including one return and one partial verification.
3. Compare the Master Listing and the payment listing against your bank statement.
4. Then onboard everyone, and retire the per-staff Google Sheets (keep them read-only for history).
