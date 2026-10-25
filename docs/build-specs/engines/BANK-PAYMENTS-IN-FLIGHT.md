# Engine spec — Bank payments being confirmed ("Being confirmed")

Built in **BILL-1**. Why: a bank (ACH) payment takes up to four business days to clear. Today the app records a
payment only once it succeeds or fails, so during those days a bill looks unpaid: it shows as late, it can get a late
fee, and Today asks Chris to chase money that is already on its way. `docs/AI-PR-READ-FIRST.md` item 2 already says
this in-between state "must be monitored". This spec records it.

**Never** treat an in-flight payment as money received. It changes nothing in totals, books, receipts or what the
customer owes. It is only a flag: "the bank is confirming a payment of $X for this bill".

## 1. Data (additive migration `20261026010000_bank_payment_in_flight`)

```prisma
model BankPaymentInFlight {
  id               String    @id @default(cuid())
  invoiceId        String?   // null until the local bill exists (first attempt of a rental-subscription invoice)
  invoice          Invoice?  @relation(fields: [invoiceId], references: [id])
  stripeInvoiceId  String?   // set for STRIPE_INVOICE rows; used to attach the bill when it is mirrored
  agreementId      String?   // set when the Stripe invoice belongs to a rental subscription
  agreement        RentalAgreement? @relation(fields: [agreementId], references: [id])
  source           String    // "STRIPE_INVOICE" | "LOCAL_CHECKOUT"
  paymentIntentId  String    @unique   // one row per Stripe PaymentIntent, ever
  amountCents      Int
  method           String    // "ach" (or the Stripe type when not us_bank_account)
  startedAt        DateTime  // when Stripe said it was processing (event created time)
  clearedAt        DateTime?
  clearedReason    String?   // "SUCCEEDED" | "FAILED" | "CANCELED" | "INVOICE_CLOSED"
  lastCheckedAt    DateTime?
  settledInStripeAt DateTime? // Stripe says it succeeded but the app could not record it yet (section 3c)
  createdAt        DateTime  @default(now())
  @@index([invoiceId, clearedAt])
  @@index([clearedAt, startedAt])
  @@index([clearedAt, lastCheckedAt])
  @@index([stripeInvoiceId])
}
```
Add `bankPaymentsInFlight BankPaymentInFlight[]` to `RentalAgreement` as well. A row always has an `invoiceId` or
an `agreementId` (checked in code and by a test).
Add `bankPaymentsInFlight BankPaymentInFlight[]` to `Invoice`. Add to `BusinessSettings`:
`pauseLateFeesWhileBankConfirms Boolean @default(true)` (owner setting, see 5).

**"In flight" rule (one function, `src/domains/billing/in-flight.ts`):**
`inFlightWhere = { bankPaymentsInFlight: { some: { clearedAt: null } } }` and
`notInFlightWhere = { bankPaymentsInFlight: { none: { clearedAt: null } } }` — every reader uses these.
**Slow-payment threshold (owner setting):** `BusinessSettings.bankPaymentSlowBusinessDays Int @default(6)` (2–20).
Starting value 6 business days: banks usually confirm in 4, so 6 leaves 2 days of normal delay before Chris is asked
to look. Shown in Settings › Money next to the late-fee switch with InfoTip "How many business days a bank payment can
take before it goes on your To do list. Starting value 6 — banks usually take up to 4." and "Restore recommended".

## 2. Writers (webhook path — keep every existing rule: dedupe by event id, global lock, evidence gathered before the transaction, `MissingWebhookEvidenceError` refill)

Add two Stripe event types to `processLockedEvent` and `gatherWebhookEvidence`:

| Event | Evidence gathered before the transaction | Effect inside the locked transaction |
|---|---|---|
| `payment_intent.processing` | `stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi.id }, limit: 1 })` → the Stripe invoice id (store it on the evidence object as `invoiceForIntent(piId)`); if none and `pi.metadata.localInvoiceId` exists, use that. | Find the local `Invoice` (`stripeInvoiceId` = the Stripe invoice id, or `id` = `localInvoiceId`). If none **and** the Stripe invoice belongs to a rental subscription (`extractSubscriptionId(stripeInvoice)` matches a `RentalAgreement.stripeSubscriptionId` — the evidence step fetches the Stripe invoice for this), create the row with `invoiceId = null`, `stripeInvoiceId`, `agreementId` (first payment attempt of a subscription bill, which the app mirrors only when it is paid or fails). If none and not a rental subscription → do nothing (other payment kinds, e.g. signing payments, keep their own handling). If the invoice already has a successful payment for this intent (`stripePaymentIntentId` + `SUCCESSFUL_PAYMENT_STATUSES`) → do nothing. Else `upsert` by `paymentIntentId` (create only; never reopen a cleared row): source, amount = `pi.amount`, method from `pi.payment_method_types[0] === "us_bank_account" ? "ach" : that type`, startedAt = `event.created`. Audit `billing.bank_payment_in_flight`. |
| `payment_intent.payment_failed` and `payment_intent.canceled` | none | If a row exists for `pi.id` and is open: set `clearedAt = now`, `clearedReason = "FAILED"` / `"CANCELED"`. **If no row exists** and the intent belongs to a local invoice (`pi.metadata.localInvoiceId`) or a Stripe invoice (same lookup as for processing), create the row **already cleared** (a "tombstone": `clearedAt = now`, the reason, `startedAt = event.created`) so a processing or unpaid-completion event that arrives later cannot open it again (rows are create-only by `paymentIntentId`). Nothing else (the existing `invoice.payment_failed` path keeps doing what it does). |

And in existing handlers (same transaction, after their current work):
- `checkout.session.completed` for a local invoice session (`isLocalInvoiceSession`) with `payment_status === "unpaid"`
  and a `payment_intent` → create the row (source `LOCAL_CHECKOUT`, amount = `session.amount_total`, method from the
  session's `payment_method_types` resolved PI if already gathered, else `"ach"`), unless one exists.
- `checkout.session.async_payment_succeeded` / `_failed` for local invoice sessions → clear the row for that intent
  (`SUCCEEDED` / `FAILED`); if no row exists yet, create it already cleared (tombstone, as above).
- **Before creating an open row** (processing or unpaid completion), the evidence step also retrieves the intent
  (`evidence.fetchPaymentIntentWithMethod`, already available); create the row open only when the intent's status is
  still `processing`. If Stripe reports `requires_payment_method` or `canceled`, create it cleared with the matching
  reason instead. If Stripe reports **`succeeded`**: when the invoice already has a payment for this intent with a
  status in `SUCCESSFUL_PAYMENT_STATUSES`, create it cleared `SUCCEEDED`; **otherwise create it open with
  `settledInStripeAt = now`** (the settlement webhook may have been missed — never clear a row whose money is not
  recorded). Section 3 picks such rows up the same night regardless of age, so recovery (3b/3c) records the payment,
  and the To do in section 4 still fires if it cannot.
- Out-of-order tests (add to the list below): failure before processing → no open row; async_payment_failed before
  the unpaid completion → no open row; succeeded before processing (settlement recorded) → no open row; **delayed processing after Stripe settled but the
  settlement webhook was missed → open row with `settledInStripeAt`, and the next nightly run records the payment
  (replay or `recoverBankSettlement`) and clears it**; each delivered twice → one row.
- **Attach the bill when it appears:** wherever the webhook code creates or finds a local `Invoice` for a Stripe
  invoice (`recordPaidInvoice`, `handleInvoicePaymentFailed`, and the OPEN mirror near `webhooks-base.ts` ~line 915),
  in the same transaction run `updateMany({ where: { stripeInvoiceId, invoiceId: null }, data: { invoiceId } })`.
  Test: processing for a not-yet-mirrored subscription invoice → row with `agreementId`; `invoice.paid` creates the bill,
  attaches the row and clears it; `invoice.payment_failed` creates the bill, attaches and clears `FAILED`.
- While a row has no bill yet, the customer record's billing line (CUSTOMER-RECORD spec) shows "A bank payment of
  {amount} is being confirmed" from the agreement's open rows; nothing else reads those rows.
- `invoice.paid` → clear every open row of that invoice (`SUCCEEDED`).
- `invoice.payment_failed` → clear open rows whose `paymentIntentId` equals the invoice's latest failed intent if the
  evidence has it; otherwise leave them (the nightly check clears them).
- Any change that makes the invoice final (`PAID`, `VOID`, `WRITTEN_OFF`, `REFUNDED`) in other code paths does **not**
  need to touch rows: readers only count open rows on open bills, and the nightly check closes stale ones with
  `INVOICE_CLOSED`.

**Tests (throwaway Postgres, in `tests/bank-in-flight-webhook-integration.test.ts`):** processing creates one row;
the same event delivered twice creates one row (event dedupe) and a *different* processing event for the same intent
still one row (unique `paymentIntentId`); processing after the payment already succeeded creates nothing;
`invoice.paid` clears it; `payment_intent.payment_failed` clears it; out-of-order delivery (paid before processing)
leaves no open row; local checkout unpaid → row, async succeeded → cleared; an intent with no invoice changes nothing;
evidence refill path (row state changed between gather and lock) works. These cover AI-PR-READ-FIRST item 1 (duplicate
delivery) and item 2 (delayed settlement) explicitly.

## 3. Nightly safety check (inside the existing `/api/cron/billing-reconcile`, new `runAutomation` rule
`billing-reconcile:bank-in-flight`)

`checkBankPaymentsInFlight(now)` in `src/domains/billing/in-flight.ts`:
1. Rows open with `startedAt` older than 2 calendar days **or with `settledInStripeAt` set** (any age), ordered by **`lastCheckedAt` ascending with never-checked
   rows first** (`orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { startedAt: "asc" }, { id: "asc" }]`),
   at most 50 per night. Every row the run looks at — still processing, cleared, **or a Stripe error** — gets
   `lastCheckedAt = now`, so the next night's batch moves on to rows that waited longest.
2. For each, **outside any transaction**, `stripe.paymentIntents.retrieve(paymentIntentId)`.
3. **PI `succeeded` — recover the missed settlement first, never just clear the flag.** No other job records a
   missed incoming payment (`reconcileOne` in `reconciliation-base.ts` handles our own provider operations only), so:
   a. If the invoice already has a Payment for this intent with a status in `SUCCESSFUL_PAYMENT_STATUSES` → clear the
      row `SUCCEEDED` (the webhook did arrive).
   b. Otherwise **replay Stripe's own settlement event** through the normal webhook path: list events with
      `stripe.events.list({ type, created: { gte: startedAt − 1 day }, limit: 100 })` (paginate, at most 5 pages) for
      `type = "invoice.paid"` (source `STRIPE_INVOICE`: match `data.object.id` = the bill's `stripeInvoiceId`) or
      `"checkout.session.async_payment_succeeded"` (source `LOCAL_CHECKOUT`: match the session's `payment_intent` =
      the row's intent). For the matching event call `processStripeWebhookEvent(event)` (the exact function the
      webhook route calls — same evidence gathering, global lock, dedupe by event id, so a replay of an
      already-processed event does nothing), then settle `result.referralIdsToSettle` with `settleReferralCredits`
      exactly as `src/app/api/webhooks/stripe/route.ts` does. Re-read: if the payment now exists → clear `SUCCEEDED`.
   c. If no matching event is found (Stripe keeps events about 30 days) → **record it directly from Stripe's current
      state** with `recoverBankSettlement(rowId)` (`src/domains/billing/in-flight.ts`, below). If that also cannot
      record it, or anything throws → **leave the row open**, set `lastCheckedAt`, set
      `settledInStripeAt = now`, count `needsCheck`.

   **`recoverBankSettlement(rowId, actorUserId | null)`** — the one recovery path, used by the nightly check and by
   the To do button. Outside any lock it gathers evidence exactly like the webhook does for the settlement event:
   - `STRIPE_INVOICE`: `evidence.fetchInvoice(stripeInvoiceId)` (expands payments) and
     `evidence.fetchCashEvents(invoice)`; proceed only if Stripe says the invoice `status === "paid"`.
   - `LOCAL_CHECKOUT`: `stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })`; proceed only if
     that session has `metadata.localInvoiceId` = the row's bill and `payment_status === "paid"`; gather what
     `recordLocalInvoiceCheckoutPayment` needs (the same evidence `gatherAsyncPaymentSucceeded` gathers).
   Then one transaction that takes the **same global webhook lock** (`SELECT pg_advisory_xact_lock(174831, 1)`),
   then — when `actorUserId` is not null (the To do button) — `assertActiveTeamActor(tx, actorUserId, ["OWNER",
   "ADMIN"])` so a person deactivated or demoted while Stripe was being asked records nothing (the nightly run passes
   null; it is trusted server code), then re-reads the row (still open) and calls the **same local functions** the webhook handlers call: export `recordPaidStripeInvoiceInTx(db, evidence,
   stripeInvoice)` from `webhooks-base.ts` as the body `handleInvoicePaid` already runs (move the code, keep
   `handleInvoicePaid` calling it — no behavior change), or `recordLocalInvoiceCheckoutPayment(db, evidence, session)`.
   Both already refuse to record the same charge or payment intent twice. Then clear the row `SUCCEEDED` and audit
   `billing.bank_payment_recovered` (actor = the person, or null for the nightly run). Referral settlement after commit
   like the webhook route. Tests: recovery records once; running it twice records once; a webhook arriving during
   recovery waits on the lock and then records nothing new; Stripe saying "not paid" leaves the row open; **an admin archived (or demoted to STAFF) between the evidence
   step and the transaction → refused, nothing recorded, row still open**; a row with no bill yet recovers through the
   `invoice.paid` replay (which creates the bill). The bill
      keeps showing "Being confirmed" (so no late fee or reminder), and To do raises it (section 4).
   Other PI statuses, in a short transaction per row (`SELECT … FOR UPDATE` on the row, re-check still open):
   `requires_payment_method` / `canceled` → clear `FAILED` / `CANCELED`; still `processing` → only
   `lastCheckedAt`. If the row has a bill and it is no longer open → clear `INVOICE_CLOSED` (rows with no bill yet skip this check). A Stripe error on one row is counted,
   its `lastCheckedAt` is set, and the run continues.
4. Counts returned to `automationCounts` (`checked`, `cleared`, `recovered`, `needsCheck`, `stillProcessing`,
   `errors`).
Test with a fake Stripe client: each PI status, error skip, the 50 limit; **a succeeded intent whose `invoice.paid`
webhook never arrived** → the replay records the payment through `processStripeWebhookEvent`, the bill becomes PAID and
the row clears; the same night run twice records it once (event dedupe); no matching event → row stays open with
`settledInStripeAt` set and no late fee; and **rotation**: with 120 open rows that
 stay processing, three nightly runs check 50, 50 and then the remaining 20 plus the 30 checked longest ago; rows that
 error are not re-checked before rows never checked. Add the index `@@index([clearedAt, lastCheckedAt])`.

## 4. To do

New category **`BANK_PAYMENT_SLOW`** (group `money` in `INBOX_GROUP`, severity medium): an open row with `startedAt`
more than **`bankPaymentSlowBusinessDays`** business days ago (`addBusinessDays`; starting value 6), **or** any open row with `settledInStripeAt` set (severity
high; title `"Stripe says the bank payment for bill #{number} cleared, but it isn't recorded yet"`, detail
`"{formatMoney(amount)} from {customer}. Try recording it again; if it still won't record, compare with Stripe."`,
primary action **"Record it now"** = a form posting to `recoverBankSettlementAction(rowId)` (OWNER/ADMIN; calls
`recoverBankSettlement(rowId, actorId)`; toast "Recorded {amount}" or the plain reason it could not), secondary
"Compare with Stripe" → `/desk/billing/reconciliation`, which also lists these rows in a new read-only section "Bank
payments Stripe says cleared" (customer, bill, amount, date) with the same "Record it now" button per row). Title `"Bank payment for bill #{number} is taking longer than
usual"`, detail `"{formatMoney(amount)} from {customer} started {formatShortDate(startedAt)}. Banks usually confirm in
4 business days. Check it in Stripe if it doesn't clear soon."`, href = the bill page (rows with no bill yet: the
customer record; title "Bank payment for {customer}'s rental is taking longer than usual"). Test: changing the setting
from 6 to 3 moves a 4-business-day-old payment onto To do. Built with a new pure builder
`bankPaymentSlowException` in `rules.ts`; queried in `getExceptionOverview` with the standard cap.
`PAST_DUE_INVOICE` items **exclude** bills with an open row (add `notInFlightWhere` to its query) — the bill shows as
"Being confirmed" instead of late.

## 5. Late fees

In `applyLateFeeBatch` (`src/domains/billing/late-fees.ts`), when `pauseLateFeesWhileBankConfirms` is true, add
`notInFlightWhere` to the candidate query **and** re-check after the row lock (`SELECT … FOR UPDATE` already used):
if the locked invoice has an open in-flight row, skip it. When the row later clears as FAILED, the normal late-fee
run picks the bill up again on its next run (grace counts from the due date as today — no new rule).
Setting on the Settings page (Money section; AR-8 moves it): switch **"Pause late fees while a bank payment is being
confirmed"**, starting value **on**, InfoTip: "When a customer pays by bank transfer it takes a few days to clear.
While it does, no late fee is added to that bill. Turn this off to charge late fees by the due date no matter what."
Owner only; audited like the other billing settings. Test: in-flight bill gets no fee with the setting on, gets one
with it off; FAILED clear → fee on the next run.

## 6. Readers (screens)

- Bills (`MONEY-BILLS.md`): tab **"Being confirmed" {n}** between Past due and Paid (hidden when 0) = open bills with
  `inFlightWhere`; **Open** and **Past due** exclude them. Pill (first match): in flight → **"Being confirmed"**
  (info) with InfoTip `"bill-processing"` { "Being confirmed", "The customer paid by bank transfer. Banks take up to 4
  business days to confirm. Nothing for you to do." }. Row/card detail: `"{formatMoney(amount)} by bank ·
  started {formatShortDate(startedAt)}"`. Actions: none (only ⋯).
- Customer record (`CUSTOMER-RECORD.md`): "Owes now" stays the true amount owed; add the detail line under it
  `"{formatMoney(x)} being confirmed"` when any open row exists for the customer's bills.
- Payments (`MONEY-AREA.md`): tab **"Being confirmed"** listing open rows (customer, bill, amount, started, method
  "Bank (ACH)"); pill "Being confirmed" (info).
- Bill record: pill as above; StatStrip adds "Being confirmed {amount}"; primary action becomes none (Print in ⋯).
- Status next line (AR-12 `STATUS_NEXT.bill`): being confirmed "The bank is confirming this payment. Nothing to do."

## 7. Owner and provider steps (checklist row, never blocks)

The Stripe webhook endpoint must also send `payment_intent.processing`, `payment_intent.payment_failed` and
`payment_intent.canceled`. Checklist row: "**Add three payment events to your Stripe webhook** (test mode now, live
later). Stripe dashboard → Developers → Webhooks → your appliance-desk endpoint → Update details → Select events →
add `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled` → Update endpoint. Ready
when: BILL-1 is merged. Worked if: a test ACH payment (Stripe test bank account) shows 'Being confirmed' on the bill
within a minute, and 'Paid' after Stripe settles it." Until then the local-checkout path works from events already
sent, and the nightly check catches the rest only after a processing event has created the row — say so in STATUS.
