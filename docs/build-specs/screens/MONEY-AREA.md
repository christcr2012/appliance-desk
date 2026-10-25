# Screen spec — Money area: Overview, Payments, the bill record, payment sheets

Built in **AR-3**. Bills list = `MONEY-BILLS.md` (AR-0). Design: `APP-REDESIGN.md` section 6. Roles: OWNER and ADMIN for
everything here (each page keeps `requireRole("OWNER", "ADMIN")`). **No money rule changes:** every button calls the
server action that exists today, with the same arguments. Read `docs/AI-PR-READ-FIRST.md`.

## 1. Money › Overview — new route `/desk/money`

The Money area's home. AR-1's `DESK_AREAS` money tab `overview` changes to href `/desk/money` with matches
`/desk/revenue`, `/desk/reports` (those pages stay and open from the Overview ⋯ menu).

**Data** `src/domains/billing/money-overview.ts` (new, read-only, `requireRole("OWNER","ADMIN")`):
```ts
export type MoneyOverview = {
  collectedThisMonthCents: number; collectedLastMonthCents: number;  // collectedBetween(null, …).netCents, Denver months
  owedNowCents: number; openBillCount: number;                     // billTabWhere("open")
  pastDueCents: number; pastDueCount: number;                      // pastDueInvoiceWhere(now)
  expectedNext30Cents: number;                                     // see below
  failedThisMonth: number;                                         // same rule as getRevenueDashboard().failedPaymentsThisMonth
};
export async function getMoneyOverview(now = new Date()): Promise<MoneyOverview>
```
- Months: `businessMonthBounds(now)` (this month, start → now) and the previous month (full).
- `expectedNext30Cents`: for ACTIVE agreements with `nextBillingDate` in `[now, now + 30 days)`, sum
  `rentForNextBill(lines)` (`src/domains/portal/next-bill.ts`). Rent only; no tax (the InfoTip says so).
- Extract `failedPaymentsThisMonth`'s where clause from `getRevenueDashboard` into `failedPaymentsWhere(period)` and
  use it in both (no number may differ between the two pages — integration test).

**Layout**
- `ScreenHeader` "Money"; ⋯ menu: "Rental income details" (`/desk/revenue`), "Reports" (`/desk/reports`), "Check
  against Stripe" (`/desk/billing/reconciliation`).
- `StatStrip` (phone 2×2, desktop 4 in a row): "Money in this month" `formatMoney(collectedThisMonth)` with the line
  `"Last month {formatMoney(last)}"` under the value; "Still owed" `"{formatMoney(owedNow)} · {openBillCount} bills"`;
  "Past due" `"{formatMoney(pastDue)} · {pastDueCount}"` (attention when > 0); "Coming in 30 days"
  `formatMoney(expectedNext30)` (InfoTip `"expected-30"`: "Rent from active rentals whose next bill falls in the next
  30 days. Tax is added on the bill.").
- Section "Needs a decision" — the To do items of group `money` (`INBOX_GROUP`, TODAY.md 3) from
  `getExceptionOverview()`, rendered with `InboxCard` and `inboxActions` exactly as on Today, max 10, then a link
  button "See all on Today" (`/desk/today?group=money`). Empty: one line "Nothing needs a decision."
- Section "Recent payments" — the 5 newest rows of the Payments list (section 2, tab Received) as compact cards,
  then a link button "All payments" (`/desk/payments`).
- When `failedThisMonth > 0`: a `NextStepCard` (attention) "{n} card payments failed this month" with action "See
  failed payments" → `/desk/payments?status=failed`.

## 2. Money › Payments — new route `/desk/payments`

Every money-in record. AR-1 money tab `payments` changes to href `/desk/payments`, matches
`/desk/billing/held-payments`, `/desk/billing/deposits`, `/desk/billing/reconciliation`, and `/desk/billing` with
query `view` ∈ `deposits, waiting`. `/desk/billing?view=deposits` and `?view=waiting` redirect to
`/desk/payments?status=deposits` / `?status=waiting`.

**Params** (`src/app/desk/payments/params.ts`, zod): `status` = `received` (default) | `failed` | `held` |
`deposits` | `waiting`; `q`; `method` (multi: `card`, `ach`, `check`, `cash`, `bank_transfer`, `other`); `when`
(date presets per KIT 4.4); `sort` = `newest` (default) | `oldest` | `amount-desc`; `cursor`.

**Status rules** `src/domains/billing/payment-tabs.ts` (pure):
- received: `status in SUCCESSFUL_PAYMENT_STATUSES` (both spellings — `src/domains/billing/payment-status.ts`).
- failed: `status in ("failed", "FAILED")`.
- held: `status in (HELD_PAYMENT_STATUS, HELD_CONFLICT_STATUS)`. Decided held payments (`held_to_credit`,
  `held_refunded`) are not listed in any tab; they appear only on the bill's timeline.
- deposits: renders the existing `DepositsTab` component unchanged inside the new layout.
- waiting: renders the existing `WaitingTab` component unchanged inside the new layout.
- Pills: received "Received" (good); failed "Failed" (attention); held "Needs a decision" (attention) with InfoTip
  `"held-payment"` ("A card payment arrived after the bill was given up or cancelled. Decide whether to keep it as
  credit or send it back."); held_conflict "Check this" (danger) with InfoTip `"held-conflict"` ("Refunded in Stripe
  after it was kept as credit and partly used. Look at it with your bookkeeper.").
- Method words: card "Card", ach "Bank (ACH)", check "Check", cash "Cash", bank_transfer "Bank transfer", other
  "Other".

**Data** `src/domains/billing/payments-list.ts`: `getPayments(params, now)` and `getPaymentCounts(params, now)` per
the KIT 5.1 cursor rule (sort `(createdAt, id)`), selecting only: id, createdAt, amountCents, method, status,
failureReason, invoice { id, invoiceNumber, customerId, customer { companyName, user { name, email } } }. Search `q`:
digits → `invoice.invoiceNumber`; text → customer name/email/company contains (case-insensitive). Counts: one query
per status tab (received, failed, held).

**Layout** (KIT 5.1 work queue): `ScreenHeader` "Money"; `StatusTabs` "Received", "Failed {n}" (hide 0), "Needs a
decision {n}" (= held; hide 0), "Deposits", "Waiting for Stripe"; Toolbar search "Name or bill number", filters Method
and When, sorts "Newest first", "Oldest first", "Largest first". Summary line `"{count} payments ·
{formatMoney(sum)}"` (received only). Rows/cards: customer name · `"Bill #{number} · {method word}"` · amount · pill ·
date `formatShortDate`; failed rows add `failureReason` as a detail line (plain text as stored). Card/row opens the
bill record. Held rows: primary action "Decide…" → `/desk/billing/held-payments` (the existing decision page, which
keeps its cards and actions). Empty states: received "No payments yet"; failed "No failed payments"; held "Nothing
needs a decision".

## 3. The bill record — `/desk/billing/customer/[id]/invoice/[invoiceId]` (same URL), redesigned

Data: exactly what the page loads today (`getInvoiceDetail`, the `money` select, `phoneHistory`,
`getSpendableCredits`, `taxBlock`). Add: `getBillTimeline(invoiceId)` in `src/domains/billing/bill-timeline.ts` —
payments (all statuses), refunds, credit applications and the audit rows `billing.phone_payment_started`, newest
first, as `Timeline` items (created "Bill created", payments "Payment received · {amount}" good / "Payment failed ·
{amount}" attention, held "Payment held for your decision" attention, refunds "Refunded · {amount}", credits "Paid
with credit · {amount}", phone page "Phone payment page opened"; actor = recorder name or "automatic").

**Header** (`RecordHeader`): back "← Bills" (`/desk/billing`); eyebrow `"Bill #{number}"`; title customer name
(link to `/desk/customers/{id}`); pill `billPill`; subtitle `forText` (MONEY-BILLS 3).
**StatStrip:** "Amount" · "Paid" · "Still owed" (attention when past due) · "Due" (`formatShortDate`, or "No due
date").

**Primary action by status** (first match):
| Status | Primary | Secondary |
|---|---|---|
| DRAFT with a tax block | — (the next-step card below holds "Recalculate tax") | — |
| open and owed > 0 and `stripeInvoiceId` | **Take payment** (opens the payment Sheet, section 4) | Record cash or check |
| open and owed > 0, no `stripeInvoiceId` | **Record cash or check** | — |
| PAID / VOID / WRITTEN_OFF / REFUNDED | **Print** (existing `PrintDocumentButton`) | — |
⋯ menu (only items whose condition holds): "Send a text…" (Sheet with the existing `SendTextPanel`, same props),
"Use the customer's credit…" (credits exist; Sheet with the existing credit `MoneyDecisionForm`, same props), "Refund
money…" (`refundable > 0`; Sheet with the existing refund `MoneyDecisionForm`, same props), "Give up on this bill…"
(open; Sheet with the existing `WriteOffButton customerId invoiceId`), "Print", "Frozen bill record" (final
statuses; existing `/api/documents/invoice/{id}` link, new tab), "View customer", "View statement"
(`/desk/billing/customer/{id}`).
`MoneyDecisionForm` and `WriteOffButton` keep their own confirmation steps — do not wrap them in a second dialog.

**Next step card:** DRAFT with tax block → attention card "Sales tax needs a decision before this bill can be sent"
with the problems as a short list (they are short, stored text) and the existing "Recalculate tax" form action.
Past due → "{n} days late" card with "Take payment" / "Send a text…".

**Tabs:** "Bill" (the existing `InvoiceDocument`, unchanged) · "Activity" (`getBillTimeline` + the existing
`ContextCommunicationPanel kind="Invoice"`). Desktop: Activity in the right column (KIT 5.2). Remove the "Money
decisions for this invoice" heading and its paragraph (the actions moved to ⋯). `RecordConnections` moves to the
bottom of the Activity tab.

## 4. Payment sheets (used by the bill record, the Bills list and the customer record)

- **Take payment** = a Sheet titled `"Take payment · {formatMoney(owed)}"` containing the existing
  `PaymentLinkPanel invoiceId suggestedReason` unchanged (it already offers the payment link, text/email and the
  phone payment page with its own confirmations). The Bills list "Take payment" and "Remind" buttons and the customer
  record's "Take payment" open this Sheet in place via a small client wrapper `TakePaymentSheet({ invoiceId,
  customerId, owedCents, suggestedReason })` instead of navigating; the old `#take-payment` anchor keeps working.
  The list needs `suggestedReason`: compute it on the server with `suggestPaymentLinkReason(money)` only for the rows
  on screen (it is pure; pass the same `money` fields).
- **Record cash or check** = a Sheet titled "Record cash or check" containing the existing `RecordPaymentForm` with a
  **new optional prop `lockedInvoiceId`**. Passing only this bill in `openInvoices` is *not* enough: the form's
  invoice selector defaults to "All open invoices, oldest first", which sends an empty `invoiceId`, and
  `recordManualPayment` then spreads the money over all the customer's open bills. With `lockedInvoiceId` set, the
  form renders no selector, sends that id in a hidden `invoiceId` field, and shows "For bill #{number}". The server
  path is unchanged (it already applies an explicit `invoiceId` to that bill). Test: a customer with two open bills,
  recording from the newer one pays the newer one and leaves the older one untouched. On
  success: close, toast `"Recorded {formatMoney(totalApplied)}"` (+ `" · {formatMoney(overpayment)} kept as credit"`
  when > 0), refresh.

## 5. Words (exact)
"Money in this month", "Last month {amount}", "Still owed", "Past due", "Coming in 30 days", "Needs a decision",
"Nothing needs a decision.", "See all on Today", "Recent payments", "All payments", "See failed payments",
"Received", "Failed", "Deposits", "Waiting for Stripe", "Decide…", "No payments yet", "No failed payments",
"Take payment", "Record cash or check", "Send a text…", "Use the customer's credit…", "Refund money…", "Give up on
this bill…", "Print", "Frozen bill record", "View customer", "View statement", "Bill", "Activity", "Rental income
details", "Reports", "Check against Stripe", "← Bills", "No due date".

## 6. Tests
- `tests/money-overview-integration.test.ts`: month boundaries in Denver (incl. Nov 1 DST), failed count equals the
  revenue dashboard's, expected-30 includes a bill on day 29 and not day 30.
- `tests/payment-tabs.test.ts`: tab rules incl. both spellings, held vs decided held statuses, method words.
- `tests/payments-list-integration.test.ts`: cursor once-each, search by number/name, counts match rows.
- `tests/bill-timeline-integration.test.ts`: order and words for each event kind.
- `tests/bill-actions.test.ts` (pure): primary/secondary/⋯ table above for every status combination.
- `e2e/money-area.spec.ts`: Overview numbers render; Payments tabs; bill record shows Take payment for an open bill
  and Print for a paid one; Record cash or check through the Sheet updates "Still owed"; old
  `/desk/billing?view=deposits` lands on Payments › Deposits; staff refused; axe + 5 sizes.
