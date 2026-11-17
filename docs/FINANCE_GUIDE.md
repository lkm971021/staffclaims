# Finance guide

## Daily: verification queue

**Finance → Verification queue** shows the oldest claims first. The badges mean:
- **duplicate**: a possible duplicate receipt was detected.
- **warning**: a system check flagged something (for example an amount mismatch).

In the **verification workspace**, receipts are on the left and claim details on the right. For each expense tab:

1. **Look at the document.**
   - Zoom, rotate, and switch between Original and Enhanced.
   - Open PDFs page by page.
   - **Download original** gives the unaltered file the staff member uploaded.
2. **Staff entry vs OCR reading**: ✗ marks a field where what the staff member typed differs from what was read off the receipt.
3. **System checks at submission**: amount or date mismatch, missing receipt number, possible payment-proof-only screenshot, unclear photo, and so on.
4. **Possible duplicates**: click **Compare documents side by side**, then record **Not a duplicate (override)** or **Confirm duplicate**, with an explanation. A line cannot be verified while a flag is open.
5. Work through the **checklist**. It is configurable per category under *Policy*.
6. Decide the line:
   - **✓ Verify**: optionally enter a lower *verified amount*. A reason is then required, and the claimed amount is never changed.
   - **? Query**: ask for clarification or another document.
   - **✕ Reject line**: give a reason.
7. Tick **Original hard copy received** when you receive the paper receipt.

Then complete the claim with one of:
- **Mark Finance Verified → Director**. If some lines are *Queried*, keep **Partial verification** ticked: the queried lines move to a supplementary claim (`CLM-…-S1`) returned to the staff member, and the verified lines go ahead.
- **Return whole claim to staff**: your remarks are sent to them.
- **Reject claim**: final, with a reason.
- **Advance payment**: record any advance to deduct, with its reference.

The Director only sees claims after you verify them. For **the Director's own claims**, your verification is final: they go straight to payment.

## Payment processing (by the 16th)

1. **Payments** lists claims ready for payment that are not yet in a batch.
2. Tick the claims (one company per batch), then click **Create payment batch** (for example `PAY-2026-11-001`).
3. **Excel / PDF listing**: use these for the bank transfer.
4. **The app does not transfer money.** Make the transfers in online banking as usual.
5. Back in the batch, enter:
   - the payment date
   - the method
   - the bank reference (or one per staff member)
   - optionally, upload the payment proof
6. Click **Mark batch as PAID**. Staff are notified.

A posted batch is locked by the database, and a claim can be in only one batch, so it can never be paid twice.

## Month-end

| Task | Where |
|---|---|
| Totals by status, branch, staff and category | **Finance dashboard** → *Monthly payment control* |
| Figures that don't agree | **Reconciliation checks**: for example, paid but no batch, a paid amount that differs from the verified amount, or files not yet archived |
| Reports | **Reports**: the 8 required reports, plus the **Accounting export** (with GL codes, for SQL Accounting entry) and summaries by category, payment date and accounting period. Each comes as Excel, CSV or PDF |
| Everything for audit | **All documents (ZIP)**: the month's receipts, PDFs, summaries and audit trails in the Drive folder layout, plus the register |
| Overdue staff | Listed on the dashboard after the deadline. Use the **WhatsApp message templates** (Copy → paste into WhatsApp). The app does not send WhatsApp messages itself |

## Where things are kept

- **Google Drive**: `<Company> - STAFF EXPENSE CLAIMS (APP)/YYYY/M. MON/Branch/EmpNo. Name/CLM-…/01–05`.
- **Google Sheet**: `Staff Claims - Master Claim Listing`.
- The claim page shows the archive status. **Retry Drive / Sheet sync** re-queues it.
