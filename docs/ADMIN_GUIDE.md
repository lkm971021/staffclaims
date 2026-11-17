# Administrator guide

## First-time setup checklist

1. Deploy the app (`DEPLOYMENT.md`) and create your admin account with `npm run create-admin`.
2. **Admin → Companies & branches**: check both companies and the 5 branches (SK ARENA is branch 5, under Plan B Physio Sdn. Bhd.).
3. **Admin → Expense categories**: the 35 categories from your template are loaded. For each one used, set:
   - the **SQL Accounting GL code**
   - whether a receipt, business purpose or location is required
   - the Finance checklist items
   - an optional guide amount (a soft warning only)
4. **Admin → Settings**: check the submission deadline (day 5), payment target (day 16), the e-Invoice effective date (2026-07-01) and which e-Invoice fields are Required, Optional or Hidden.
5. **Admin → Google Drive & Sheets**: connect (`GOOGLE_SETUP.md`).
6. **Admin → Users**: add staff (see below).
7. Run the acceptance checklist in `TESTING_CHECKLIST.md` with one or two real staff before going live. You can use the demo accounts first; their data stays separate.

## Adding staff

**Admin → Users → + Add user**. Fill in:
- **Employee ID**: your existing 5-digit numbers, for example `00011`.
- **Full name**: as per NRIC.
- **Email**: the Gmail they will sign in with.
- **Branch**, **Department** and **Position**.
- **NRIC** and **TIN**: these print on the Claim Summary, the same as the current form. Only the staff member, Finance and Admin can see them.
- **Roles**:
  - *Staff*: everyone who claims.
  - *Finance & Accounting*: verification and payment.
  - *Service Director*: approval.
  - *System administrator*: settings and users.
  - A person can hold several roles. For example, Alex = Staff + Director.

Staff sign in with **Continue with Google** (no password needed) or with a password you set.

To deactivate a leaver, untick **Account active**. Their claims and history are kept.

## Team leaders (submitting on behalf of others)

1. Open the leader's user page.
2. Under **Team leader: may submit claims on behalf of**, assign each team member.

When the leader starts a claim, they choose the team member as the claimant. The record shows "submitted by <leader>". Leaders cannot see other staff's claims.

## Special rules already built in

- **Director's own claims:** Finance verification is final. The claim goes straight to *Approved for Payment* and is labelled as such everywhere, including the Claim Summary and the audit trail.
- **No self-approval:** Finance users cannot verify their own claims, and the Director cannot approve their own.
- **Mixed companies:** if a claim has lines for branches of both companies, it is split into one claim per company on submission.

## Housekeeping

| Page | Use |
|---|---|
| **Sync jobs** | Failed Drive, Sheets or email jobs, with **Retry** |
| **Audit log** | Every login, change, approval, payment, export and download. It cannot be edited or deleted |
| Removing demo data | Demo accounts are flagged `DEMO` and use `@example.test` emails. Deactivate them once you go live |
