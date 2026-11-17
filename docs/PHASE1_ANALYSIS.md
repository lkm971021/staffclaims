# Staff Expense Claim App: Phase 1 Analysis & Implementation Plan

Prepared: 17 Nov 2026 · Status: **decisions confirmed 17 Nov 2026, Phase 2 build started**

**Confirmed decisions**
| # | Decision |
|---|---|
| Q1 Hosting | Decide later. The app is built as a portable Docker setup (app + PostgreSQL), with deploy guides for Railway/Render, Google Cloud Run and a VPS |
| Q2 OCR | Claude vision AI (`ANTHROPIC_API_KEY`). The staff privacy notice must mention that receipt images are processed by Anthropic's API. Without a key, OCR is switched off and the form still works |
| Q3 Login | Google sign-in **and** email + password. Only accounts registered by Admin can sign in |
| Q4 Director's own claims | Finance verification is final. Verification moves the claim straight to Approved for Payment, recorded as "Director's own claim – Finance verification final" in the audit trail |

Everything here is based on files I actually inspected. I did not change any of them:

| Source | How I accessed it |
|---|---|
| Google Sheet `REIMBURSEMENT CLAIMS TEMPLATE` (1Y9e40…) | Read through the Sheets API. Matches the uploaded `.xlsx` cell for cell |
| `1._Existing_Claim_Listing_Template.xlsx` | Formulas, validation lists, merges, formats |
| `SOP - REIMBURSEMENT CLAIMS (ALL STAFF)` (PDF) | Read in full |
| `Sample_Claims_PDF.pdf` (Director claim, Mar 2026, three Meta invoices) | Read in full |
| `SOP - PETTY CASH POLICY (ALL BM)` (Google Doc in your Drive) | Read in full |
| Existing Drive claim folders | Folder names only. No receipt contents opened |
| Codebase | **There is none.** The working directory was empty, so this is a new build |

---

## 1. What the existing template does

**Structure.** There is one Google Sheet per staff member (for example `00011. NG ZHU ER - REIMBURSEMENT CLAIMS`). Each workbook has one tab per month (`JUNE 2026`) plus a `TEMPLATE` tab. Each tab is a printable form. **No master listing exists today.**

| Area | Cells | Content |
|---|---|---|
| Header | E1 | Company name, BRN, address, email |
| Claimant block | D5–D8, H5–H8 | Full Name, NRIC No., TIN No., Department · Date, Expense Period (free text), Branch, Position |
| Lines | B10:L47 (37 rows) | No. · Inv Date · Inv. No. · Description · Supplier Name · **Receipt** ☐ · **E-Invoice** ☐ · Expense Category · **Branch (per line)** · Amount (RM) |
| Totals | L48–L50 | `Sub Total = SUM(L11:L47)` · Advance Payment (if any) · `Total Reimbursement = SUM(L48:L49)` |
| Sign-off | rows 55–58 | Requested by (`=D5`) · Approved by **CHEAH CHEN KANG (ALEX)** · Reviewed by **LOKE KAH MAN (CARMEN)**, each with a signature and a date |
| Finance only | rows 62–63 | Reimbursement Payment Date · Reimbursement Payment Method |

**Data validation, carried over unchanged as seed data:**
- **Expense Category** (35): ADVERTISEMENT, ACCOMODATION EXPENSES, BRANDING & MERCHANSISE EXPENSES, CLEANING EXPENSES, COURIER & POSTAGE CHARGES, CUSTOM DUTIES AND TAXES, ELECTRICITY, ENTERTAINMENT WITH CUSTOMER, ENTERTAINMENT WITH STAFF, GENERAL EXPENSES, GIFTS AND DONATIONS, MARKETING FEE, MACHINERY, SHOP EQUIPMENT, PHYSIOTHERAPY EQUIPMENT, PILATES EQUIPMENT, FURNITURE & FITTINGS, OFFICE INTERNET CHARGES, OFFICE PHONE MOBILE PLAN CHARGES, OFFICE REFRESHMENT, PARKING, PETROL, PRINTING, PROFESSIONAL FEE, SHIPPING & DELIVERY FEE, SHOOTING FEE, STAMPING FEE, STATIONERY, STAFF WELFARE, TOLL, TRAVELLING EXPENSES, UPKEEP OF EQUIPMENT, UPKEEP OF FURNITURE & FITTINGS, UPKEEP OF SHOP EQUIPMENT, WATER
- **Branch:** PJ MIDTOWN, PJ UPTOWN, PJ MIDTOWN (PLAN V), JB SUTERA - PLAN B PHYSIO SOUTH, ALL
- **Reimbursement payment method:** INSTANT TRANSFER (OCBC), TRANSFER WITH SALARY, PETTY CASH, CHEQUE

**Points the app should keep or fix:**
1. **Branch is set per line, not per claim.** One claim can charge several branches. The app keeps branch at line level and defaults it to the claimant's branch.
2. **The branches belong to two companies.** According to the Petty Cash SOP:
   - PLAN B PHYSIO SDN. BHD. covers PJ Midtown (HQ), PJ Uptown and PJ Midtown (Plan V).
   - PLAN B PHYSIO SOUTH SDN. BHD. covers JB Sutera.

   A claim that mixes both companies is a problem for accounting, because each company reimburses and books its own costs. **Proposed default:** the app splits lines into one claim per company automatically. Lines charged to "ALL" go to the holding company.
3. **Advance Payment is added, not deducted.** `SUM(L48:L49)` only works if Finance types the advance as a negative number. The app stores advances as a positive figure and **deducts** it.
4. **Expense Period is free text.** The June tab reads "1 June 2026 - 31 June 2026", but June has 30 days. The app works the period out from the claim month.
5. **The Receipt and E-Invoice checkboxes record what type of document was attached.** The app keeps both as document-type flags on each line.
6. **The template has no columns for** Business Purpose, the staff member's own payment method (cash / card), the e-Invoice detail fields, or any status or verification fields. All of these are added.
7. **NRIC and TIN print on the form.** These are personal data under PDPA. They go on the staff profile, only Finance and Admin can see them, and they are printed only on the Claim Summary PDF.

**What the Petty Cash Policy adds:**
- The **RM200 threshold**. Expenses above RM200 go through staff claims or a bank transfer rather than petty cash. This is a petty-cash rule, so it is **not** applied as a cap on claims. It can be set up as an optional flag per category.
- **A scan alone is not enough for LHDN, so the hard-copy original is required.** The app adds a Finance checkbox, "Original hard copy received" (date / by), on each line. It is configurable and only shows a warning; it never blocks the claim.
- Screenshots and e-wallet transfer proofs are not valid expense proof. These become checklist items on the Finance verification screen.
- e-Invoice is "a must" from July 2026 **where available**. The app will **warn but not block**, as you asked.
- Petty Cash itself (the BM custodian float) is a **separate process** and is **out of scope** for v1.

---

## 2. Recommendation: one Master listing, with per-staff views

**Recommendation: a single Master Claim Listing, synced from the app database. Individual staff listings are replaced by app views and a Claim Summary PDF in your current form layout.**

Why:
- With one database there is one source of truth, so the same figures can't disagree across 20+ workbooks.
- Staff see their own history in the app, so they no longer need their own spreadsheet.
- Finance, Director and auditors still get the familiar signed form, because the **Claim Summary PDF reproduces your current form**: same header, same columns, Requested / Approved / Reviewed blocks, and the Finance payment box. It is generated automatically, with the electronic approval details (name and timestamp) in place of signatures.
- **Optional, for the transition period:** the app can also write each staff member's monthly tab into a **new** per-staff spreadsheet in your template layout. I'll build this if you want it. It is off by default.

**New Google Sheet "Staff Claims – Master Listing"** (created by the app; your template is never touched):

| Tab | Content |
|---|---|
| `Master Register` | One row per expense line, with every field listed in §8 of your brief |
| `Claims` | One row per claim: totals, status, approvers, Drive link |
| `Payments` | One row per payment batch and the claims it covers |
| `Monthly Summary` | Totals by month × branch × status |

The sync updates rows in place, keyed by claim reference and line number, so re-running it never duplicates rows. Sheets is used for **reporting only**: an edit in the Sheet is overwritten on the next sync. This is stated on the Sheet.

---

## 3. Architecture

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript**, installable PWA | One codebase for the mobile staff app and the desktop Finance and Director screens. Large ecosystem, so easy to hand over to another developer |
| UI | Tailwind CSS + shadcn/ui | Clean professional look, accessible, fast to adjust |
| Database | **PostgreSQL** + Prisma ORM | Relational integrity for money and audit data. Schema migrations are kept in git |
| Auth | Auth.js. See decision Q3 | Secure sessions, role checks on every server action |
| Background jobs | **pg-boss** (job queue stored in Postgres) | Drive and Sheets uploads retry with backoff. A Google outage never loses a claim |
| Image → PDF | Browser canvas (crop, rotate, enhance), **pdf-lib** on the server | Originals are always kept. The PDF is generated separately |
| Perspective correction | OpenCV.js (`jscanify`), loaded only on the capture screen | Automatic edge detection with manual corner adjustment |
| OCR | Pluggable interface. See decision Q2 | Results are only ever suggestions |
| PDF reports | pdf-lib / React-PDF | Claim Summary in your form layout, plus reports |
| Exports | ExcelJS (xlsx), CSV, PDF | |
| Email | SMTP (Gmail SMTP with an app password, or a provider such as Resend) | Optional. In-app notifications always work |
| Google | `googleapis` (Drive v3, Sheets v4) | See §7 |
| Time / currency | All dates stored in UTC and shown in **Asia/Kuala_Lumpur**. Money stored as integer **sen** (never floating point) and shown as MYR | |

**Local file storage.** Uploaded files are first written to private storage on the server, with a SHA-256 hash recorded. Only then are they queued for Drive. If Drive is down, the claim is still safe, and its archive status stays "Pending archive" until the upload succeeds.

---

## 4. Database schema (main tables)

```
Company(id, name, brn, tin, sst_no, address)                       -- 2 seeded from the Petty Cash SOP
Branch(id, code, name, company_id, drive_folder_id, active)       -- seeded from template list (+ SK ARENA?)
User(id, employee_no "00011", name, nick_name, email, phone, nric*, tin*, department, position,
     branch_id, roles[], active, password_hash | google_sub, created_at)   * restricted fields
TeamDelegation(leader_id, member_id, active)                       -- configurable "submit on behalf"
ExpenseCategory(id, name, gl_account_code, requires_receipt, requires_location,
     einvoice_applicable, special_approval, warning_threshold_sen, checklist jsonb, active)
Setting(key, value)   -- submission day (5), payment day (16), e-Invoice effective date (2026-07-01),
                      -- e-Invoice field config, Drive root IDs, Master Sheet ID, retention years, etc.

Claim(id, ref "CLM-2026-11-0001", company_id, claimant_id, submitted_by_id, claim_month,
      status, version, advance_sen, submitted_at, deadline_at, archive_status, drive_folder_id,
      parent_claim_id (supplementary), idempotency_key, created_at, updated_at)
ClaimLine(id, claim_id, line_no, expense_date, category_id, branch_id, supplier, description,
      business_purpose, location, receipt_no, amount_sen, staff_payment_method, doc_is_receipt,
      doc_is_einvoice, supplier_tin, supplier_brn, supplier_sst, invoice_no, invoice_date,
      einvoice_uuid, einvoice_status, remarks,
      fin_status (PENDING|VERIFIED|QUERIED|REJECTED), verified_amount_sen, fin_comment,
      hardcopy_received_at, hardcopy_received_by)
Document(id, claim_id, line_id?, kind (ORIGINAL|ENHANCED|COMBINED_PDF|CLAIM_SUMMARY|ADDITIONAL|
      PAYMENT_PROOF|APPROVAL_RECORD), version, supersedes_id, filename, mime, size, sha256,
      phash, storage_key, drive_file_id, drive_status, uploaded_by, uploaded_at)
OcrResult(id, document_id, engine, raw jsonb, supplier, date, receipt_no, subtotal, tax, total,
      tin, brn, sst, confidence, created_at)            -- never overwritten by staff edits
DuplicateFlag(id, line_id, matched_line_id, rule (FILE_HASH|IMAGE_SIMILAR|INV_NO|SUPPLIER_DATE_AMT),
      score, decision (OPEN|NOT_DUPLICATE|DUPLICATE), decided_by, decided_at, explanation)
ClaimVersion(id, claim_id, version, snapshot jsonb, reason, created_by, created_at)  -- every resubmission
Adjustment(id, line_id, field, old_value, new_value, reason, by, at)  -- verified/approved amount changes
WorkflowEvent(id, claim_id, from_status, to_status, action, remarks, actor_id, actor_role, at)
PaymentBatch(id, ref "PAY-2026-11-001", company_id, payment_date, method, bank_ref, remarks,
      proof_document_id, status (DRAFT|POSTED), created_by, posted_by, posted_at)
PaymentItem(batch_id, claim_id UNIQUE, amount_sen)     -- UNIQUE claim_id = cannot be paid twice
Notification(id, user_id, type, claim_id, title, body, read_at, emailed_at, created_at)
AuditLog(id, actor_id, entity, entity_id, action, before jsonb, after jsonb, ip, at) -- append-only
SyncJob(id, kind (DRIVE_UPLOAD|SHEETS_SYNC|...), payload, attempts, last_error, status)
```

**Database-level protections:**
- AuditLog and WorkflowEvent are **append-only**. A Postgres trigger rejects UPDATE and DELETE on them.
- Claims are never hard-deleted. Only drafts can be discarded.
- Claim references and batch references come from a per-month counter row, which avoids gaps and collisions.

---

## 5. Permission matrix

| Action | Staff | Team Leader* | Finance | Director | Admin |
|---|---|---|---|---|---|
| Create / edit own draft, upload docs | ✅ | ✅ (+ assigned members) | ✅ own | ✅ own | – |
| Submit / resubmit returned claim | own | own + members | own | own | – |
| View claims & documents | **own only** | own + members' claims they submitted | **all** | claims at or past Finance Verified | config only |
| See other staff totals / dashboards | ❌ | ❌ | ✅ | ✅ (approval scope) | ❌ |
| View NRIC / TIN | own | own | ✅ | ❌ | ✅ |
| Finance verify / query / reject lines | ❌ | ❌ | ✅ (**not own claim**) | ❌ | ❌ |
| Resolve duplicate flags | ❌ | ❌ | ✅ | view | ❌ |
| Approve / reject / request clarification | ❌ | ❌ | ❌ | ✅ (**not own claim**, see Q4) | ❌ |
| Payment batches, mark Paid | ❌ | ❌ | ✅ | view | ❌ |
| Reports, exports, ZIP downloads | own claim PDF | own | ✅ | ✅ | ❌ |
| Users, branches, categories, deadlines, e-Invoice config, Google setup | ❌ | ❌ | categories & checklists | ❌ | ✅ |
| Change original receipts or Finance records | ❌ | ❌ | ❌ (new versions only) | ❌ | ❌ |

\*Team leader is a configurable delegation, set per member by Admin. The **claimant is always the team member**, and "submitted by" records the leader.

Checks run on the server for every request: role, ownership and status. Every file download goes through the app with a permission check. **Drive links are never given to staff.**

---

## 6. Claim workflow

```
DRAFT ──submit──▶ PENDING FINANCE VERIFICATION ──Finance──▶ PENDING DIRECTOR APPROVAL ──Director──▶ APPROVED FOR PAYMENT ──Finance batch posted──▶ PAID
  ▲                    │      │                                 │        │
  │                    │      └──▶ REJECTED (final, reason)      │        └──▶ REJECTED (final, reason)
  └── RETURNED TO STAFF ◀┘ (Finance: lines queried)              └──▶ CLARIFICATION REQUESTED ──▶ back to Finance queue
```

- Your ten status names are kept as labels. Pairs that describe the same moment are merged:
  - "Submitted" and "Pending Finance Verification" become one status.
  - "Finance Verified" and "Pending Director Approval" become one status.
  - "Director Approved" and "Approved for Payment" become one status.
  - The timeline still shows each step separately.
- **Line-level verification.** Each line is marked Verified, Queried or Rejected. Finance can complete verification only when no line is still Pending.
  - If some lines are **Queried**, Finance chooses one of two options:
    - (a) **Return the whole claim**, or
    - (b) **Proceed with the verified lines**. The queried lines move to a linked supplementary claim (`CLM-2026-11-0001-S1`) that goes back to the staff member.
  - **Option (b) is the default proposal.** It means good lines are not held up by one bad receipt.
- The **verified amount is stored separately from the submitted amount.** Any difference needs a reason and is written to the Adjustment table.
- When staff resubmit a returned claim, it **becomes version 2 of the same reference**. Version 1 is frozen as a snapshot, and older documents are kept and marked as superseded.
- Nothing moves forward automatically. Every transition is a deliberate action by a named user and is recorded as a WorkflowEvent.
- **Self-approval is blocked.** Finance cannot verify their own claim, and the Director cannot approve their own. See Q4.

---

## 7. Google Drive & Sheets

**Important finding:** your Drive is a **personal Gmail account** (`planbfinanceacc@…`), not Google Workspace. That has two consequences:
- **A service account cannot upload into a personal "My Drive"**, because service accounts have no storage quota and Shared Drives need Workspace.
- **The integration therefore uses OAuth as the Finance Google account.** You sign in once on the Admin page, and the app stores an **encrypted refresh token**. All files are then owned by your account, stay private, and are never shared by link.

**Proposed folder structure.** This fits the pattern you described (Holding/Subsi › Branch › Expenses › Claims) and your existing `5. CLAIMS` › `11. NOV` style:

```
<Configured root per company>  e.g. "PLAN B PHYSIO SDN. BHD." / "… / 5. CLAIMS" (you pick the folder IDs in Admin)
  └ STAFF EXPENSE CLAIMS (APP)/
     └ 2026/
        └ 11. NOV/
           └ PJ MIDTOWN/
              └ 00011. NG ZHU ER/
                 └ CLM-2026-11-0001/
                    01_Claim_Summary/      CLM-2026-11-0001 - Claim Summary v2.pdf
                    02_Original_Receipts/  L01-original-1.jpg … (never altered)
                    03_Combined_PDF/       CLM-2026-11-0001 - Supporting Documents v2.pdf
                    04_Additional_Supporting_Documents/
                    05_Approval_Records/   CLM-2026-11-0001 - Audit Trail.pdf
```

**Idempotency.** Each folder's ID is recorded in the database once it is created. Lookups also check `appProperties.claimRef`, so a retried upload never creates a second folder. A claim's archive status becomes `ARCHIVED` only after every required file has a confirmed Drive file ID.

**Credentials you will need to set up** (step-by-step guide comes with the build):
1. A Google Cloud project with the **Drive API** and **Sheets API** enabled.
2. An OAuth consent screen and an **OAuth client ID (Web)**, with a redirect URI on the app's domain.
3. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` set as environment variables. The refresh token itself is stored encrypted in the database after you connect.
4. Root folder IDs for each company, chosen in Admin.
5. Optional: an `ANTHROPIC_API_KEY` for AI OCR (Q2), and SMTP credentials for email.

**Live vs mock.** Until real credentials are configured, the Drive and Sheets adapters run in **mock mode**. In mock mode they write to a local `mock-drive/` folder and a local xlsx file, and the UI shows a **"MOCK – not connected to Google"** banner. I won't report Drive or Sheets as working until they have run against your real account.

---

## 8. Duplicate detection, OCR & checks

**Duplicate detection** runs on upload and on submit. It compares against **all** staff, but only Finance sees matches from other staff. A match raises a flag and never rejects the claim. The checks are:
1. Identical file (SHA-256 hash).
2. Visually similar image (perceptual hash, Hamming distance ≤ 8).
3. Same supplier and receipt or invoice number.
4. Same supplier, date and amount.

The Finance workspace shows each match **side by side with the earlier claim's document**. Finance records a decision and an explanation, and the full history is kept.

**OCR** extracts supplier, BRN, receipt or invoice number, date, subtotal, tax, total, SST number and TIN. The extracted values are stored in `OcrResult` and **never overwritten**. The app then warns on:
- an amount mismatch,
- a date mismatch,
- a missing receipt number,
- low confidence or an unreadable document.

**e-Invoice fields** (supplier TIN, BRN, SST number, invoice number and date, validation status, UUID):
- They show only when the expense date is on or after the configured effective date (**2026-07-01**) **and** the category is marked e-Invoice-applicable.
- Each field can be set to required, optional or hidden in Admin.
- Missing values raise **warnings for Finance only**. The app never labels a document an invalid tax document.

---

## 9. Build plan (in the priority order you set)

| Step | Scope | Result |
|---|---|---|
| **1. Core** (P1) | Project scaffold, DB and migrations, seed data (companies, branches, 35 categories, demo users clearly marked DEMO), login and roles, staff PWA (dashboard, claim form, multi-line, camera capture, crop/rotate/enhance, combine to PDF), workflow, Finance verification, Director approval, payment batches, Claim Summary PDF in your form layout, Drive and Sheets adapters (live and mock), job queue | End-to-end working system |
| **2. Controls** (P2) | Line-level and partial verification with supplementary claims, adjustments, side-by-side verification workspace (zoom, rotate, compare OCR), duplicate engine, OCR module, category policy and checklists, versioning, audit trail screens | Finance control layer |
| **3. Reporting** (P3) | Payment control dashboard, 8 reports, accounting export with GL code mapping, reconciliation warnings, management charts, notifications (in-app, email, WhatsApp copy templates), deadline reminders, ZIP downloads per claim and per month | Month-end toolkit |
| **4. Test & hand over** | Automated tests (permissions, workflow, money arithmetic, duplicate rules), Playwright runs on emulated iPhone and Android, live Google tests once credentials exist, all guides listed in §14 of your brief | Acceptance checklist |

**Limits of what I can verify here.** Tests in this container can emulate iPhone and Android browsers. A real device check of camera capture (one iPhone, one Android) has to be done by you after deployment. I'll provide a short script for it.

---

## 10. Decisions and missing business rules

**Decisions needed before coding:**
1. **Hosting.** Where will the app run? This determines the database and deployment setup.
2. **OCR engine.** Choose between free on-device OCR (Tesseract) and Claude vision. Claude vision is far more accurate on receipts, but costs per receipt and sends receipt images to Anthropic's API.
3. **Login.** Choose between Google sign-in (staff already have Gmail) and email + password.
4. **The Director's own claims.** The sample is Alex's own claim, approved by Alex. Who approves the Director's claims?

**Default assumptions I'll use unless you say otherwise:**

| # | Rule | Default |
|---|---|---|
| A | Mixed-company lines | Split automatically into one claim per company (§1.2) |
| B | Claim month | The month of the expense date. One open claim per staff, per company, per month. Late receipts from a previous month go into that month's claim and are flagged "late" |
| C | Late submissions (after the 5th) | Allowed, flagged as overdue for Finance. Not blocked |
| D | Director "Request Clarification" | Returns the claim to the Finance queue with the question. Finance then queries the staff member or answers it |
| E | Partial verification | Supplementary claim option (§6) |
| F | Advance payment | Entered by Finance, deducted from the total reimbursement |
| G | Hard-copy receipt received | Tracked per line, warning only |
| H | Retention | 7 years from the end of the financial year (in line with the record-keeping period under the ITA 1967 / Companies Act 2016). Configurable. Nothing is auto-deleted; the app only reports records past retention |
| I | Branch list | The 4 branches from the template plus "ALL". **SK ARENA (SKBA)** appears in the Petty Cash SOP but not in the claim template, so I need to know which company it belongs to |
| J | Employee ID | Your existing 5-digit numbers (`00011`) |
| K | Financial year end | Assumed 31 December. The accounting-period report needs this confirmed |
| L | SQL Accounting GL codes | Left blank. You fill them in per category in Admin |

**Documents I'd still like to have** (not blocking):
- The "What is Valid & Supportive Documents?" deck, which would become the per-category checklists.
- The "Company Reimbursement Policy & SOP" that the Petty Cash SOP refers to, if it is different from the staff SOP.
