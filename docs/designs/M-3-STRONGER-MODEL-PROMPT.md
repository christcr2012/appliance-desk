# M-3 — Card payment for local invoices: prompt for a stronger model (stop rule S-M2)

**Why this exists.** `docs/designs/BATCH-M.md` M-3 says to stop and write this prompt if the existing Stripe checkout/webhook
code cannot attach a payment to a local invoice without a design change. Checked 2026-10-23: it cannot.
`handleCheckoutSessionCompleted` in `src/domains/billing/webhooks-base.ts` only understands sessions tagged `estimateId`
(estimate deposit), `agreementId` (rental) or the W-22 `attemptId`/`orderFingerprint` tags (it throws on those until the
W-22 settlement handler is wired). A session for a shop sale (a local invoice with no Stripe invoice) would fall through
as "ignored", so the customer would be charged and the invoice would stay unpaid. Making it work is a change to the
webhook contract on money, which `docs/AI-PR-READ-FIRST.md` treats as blocking design input.

## Task
Add "Pay by card" for a shop sale (`Invoice.saleKind = "SHOP_SALE"`) on the desk sale page (`/desk/sales/[id]`), and for customers with accounts in the portal.

## Requirements
1. New `ProviderOperation` kind `LOCAL_INVOICE_CHECKOUT`, key `local-invoice-checkout-<invoiceId>-<amountCents>` (a retry returns
   the same Checkout URL; a different amount makes a new operation). Follow `src/domains/billing/provider-ops.ts`.
2. Session metadata `localInvoiceId`, `localInvoiceOperationKey`. Amount = what is still owed at creation; refuse a voided,
   paid or zero-balance sale; refuse a walk-in sale in the portal (no account) but allow it from the desk.
3. Webhook: a new branch in `handleCheckoutSessionCompleted` **and** the `async_payment_succeeded` / `async_payment_failed`
   handlers. Count money only when Stripe says `payment_status = "paid"` (ACH may be delayed). Record through the existing
   receipt path (`createReceiptWithAllocations`, source STRIPE) so allocations, invoice status and the books follow the same
   rules as a manual payment. Lock the customer ledger and the invoice row; duplicate event delivery must change nothing.
   If the sale was cancelled or already paid when the money arrives, record the receipt as unapplied customer credit and
   raise a To do for the owner — never lose or double-apply the money.
4. Refunds: confirm the existing refund path can refund a Stripe receipt that is allocated to a local invoice (tax is
   reversed with it, design D-K10). If it cannot, say so in the PR rather than working around it.
5. Tests on throwaway Postgres with a fake Stripe client: create + replay, paid, async-paid, async-failed, duplicate
   delivery, sale cancelled before payment arrives, amount mismatch. Real Stripe test-mode observation goes on
   `docs/OWNER-CHECKLIST.md` (needs Chris's Stripe test keys); live Stripe stays off.
6. Never enable live payments. Keep `ci.yml` permissions as they are.

## Read first
`docs/AI-PR-READ-FIRST.md`, `src/domains/billing/webhooks-base.ts`, `src/domains/billing/provider-ops.ts`,
`src/domains/billing/ledger.ts`, `src/domains/billing/manual-payments.ts`, `src/domains/sales/index.ts`,
`src/app/desk/sales/actions.ts`, `docs/designs/BATCH-M.md` (M-3 and S-M2).
