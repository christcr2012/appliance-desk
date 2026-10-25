# Engine spec — Fair late fees: tell first, never change a payment in progress (FEE-1)

Chris, 2026-10-25: "A late fee should not be charged before the customer is notified, so it should not 'slip in' to
a payment … going through that the customer would not reasonably expect to be charged a different payment amount."
His fee policy (IN-84, updated by Chris 2026-10-25 "We should just follow that rule for all late fees for simplicity"): $5 flat, **only once a bill is more than 10 days late (fee on day 11)**, for **every** rental, once per overdue bill, waivable with a reason (owner
settings, DEC-2 makes new agreements read them). This spec replaces the "add the fee to the overdue bill" behaviour
of `applyLateFeeBatch` (`src/domains/billing/late-fees.ts`) with three rules. Read `docs/AI-PR-READ-FIRST.md` (money,
customer messages). Depends on BILL-1 (payments being confirmed). No live email or texts are turned on by this.

## Rule 1 — The customer is told before any fee
- New notice "Your payment is late" (template `late-payment-notice`, owner-editable wording with restore, Spanish via
  the existing language system): "{name}, your payment of {amount} for {what} was due {date}. If it isn't paid by
  {feeDate}, a late fee of {fee} will be added to your next bill. Pay now: {link}." Sent through the existing customer
  message path (`deliverMessage`, customer's channel and consent, existing switches) on the business day that is
  `lateFeeNoticeDaysBefore` before the fee date (new owner setting, starting value **2**: "How many days before a late
  fee the customer is warned. Starting value 2, so they have time to pay."; 1–5).
- **No delivered notice, no fee.** A fee may be charged only when a `MessageDelivery` for that notice and that bill is
  ACCEPTED/DELIVERED (or Chris records "Told them by phone on {date}" on the bill — audited). If the notice couldn't
  go (customer email off, no consent, undeliverable), the fee date passes **without** a fee and To do shows "No late fee
  for {customer} — they weren't warned yet" with **Send the warning** (sets a new fee date `lateFeeNoticeDaysBefore`
  days after it is delivered) and **Skip the fee** (waive with a reason). While live customer email is off, this means
  no automatic fees — honest and safe.
- The fee date is `dueDate + lateFeeGraceDays` (agreement snapshot), but never earlier than `notice delivered +
  lateFeeNoticeDaysBefore` days.

## Rule 2 — Never during a payment in progress
On the fee date, inside the bill's row lock (`SELECT … FROM "Invoice" … FOR UPDATE`, the same lock BILL-1's in-flight
writers take), **no fee** when any of these is true — this is a rule, not a setting (BILL-1's switch
`pauseLateFeesWhileBankConfirms` is dropped): an open bank payment row (`BankPaymentInFlight`), a Stripe checkout or
payment link for this bill started before the fee date and not expired, or a payment recorded on or before the fee date
that covers the amount due. If such a payment later **fails**, the bill gets a fresh notice ("Your payment didn't go
through …") and a new fee date (`lateFeeNoticeDaysBefore` days after that notice is delivered) — the customer is never
charged a fee for the days their payment was going through.

## Rule 3 — The fee is its own charge, never mixed into what they're paying
- The fee is **not** added to the overdue bill's amount (that bill keeps the amount the customer was told and may be
  paying). Instead a `PendingCharge` (new model: `{ id, customerId, agreementId, kind: LATE_FEE, amountCents,
  forInvoiceId, noticeDeliveryId, addedOn, appliedToInvoiceId?, waivedAt?, waivedReason?, waivedByUserId? }`,
  `@@unique([forInvoiceId, kind])` = once per overdue bill) is recorded.
- It is put on the customer's **next** bill as a separate line "Late fee for bill #{n} (was due {date})": for local
  bills, when the next bill is created; for Stripe subscription bills, as a Stripe invoice item for the **upcoming**
  invoice created the moment the fee is recorded (so it is on the bill the customer sees before it is charged), with an
  idempotency key from the `PendingCharge` id. If the rental has ended and no next bill will come, a separate one-line
  bill "Late fee" is created with its own due date (`dueDays` setting) and the customer is told.
- The next bill's reminder (`billing-reminder`) mentions it: "This bill includes a {fee} late fee for bill #{n}."
- **Waive** (DEC-2 `waiveLateFee`, now on the `PendingCharge`): before it's billed → marked waived, never billed;
  after → credit line on the following bill. The waiver audit and reason stay.
- Existing fees already added the old way stay on their bills (history unchanged).

## Legal rules (Chris, 2026-10-25: "make sure our late fees … comply with any applicable laws")
Facts: `docs/research/2026-10-25-late-fee-law.md`. These are enforced in code, not left to settings:
1. **Classify every agreement** when signed and store it (`Agreement.lateFeeClass`: `CONSUMER_LEASE` | `CONSUMER_SHORT`
   | `BUSINESS`): household renter (a person, not a company/property manager) **and** starting term over 4 months →
   CONSUMER_LEASE (Colorado UCCC 5-2-203 and federal Reg M apply); household month-to-month (no early-ending charge that
   stretches the commitment past 4 months) → CONSUMER_SHORT; business/organization renter → BUSINESS. Unknown → treated as
   CONSUMER_LEASE.
2. **Earliest fee day — one rule for everyone** (Chris, 2026-10-25): no fee unless the bill isn't paid in full within
   **10 days** after its due date, so the fee is on day 11 at the earliest, for every agreement class. That is Colorado's
   UCCC rule for household leases over 4 months (5-2-203), applied to all rentals for simplicity. Setting
   `lateFeeGraceDays` starts at **10** and the screen refuses anything lower ("Colorado's rule: at least 10 days").
   The class is still stored (Regulation M disclosures and the UCCC filing need it).
3. **Cap**: every late fee ≤ **$15** (rule book `co.uccc.lease_delinquency_cap`, seeded 1500 cents) — same rule for all,
   for simplicity; the setting refuses higher. Same fee whatever the payment method (never a card surcharge).
4. **Once per bill**, never daily, never a fee on a fee, never because an *older* bill is unpaid. **Payment order**: a
   payment applies to the oldest unpaid rent installments first and to late fees last (never makes a new fee appear).
5. **Window**: assessed within **30 days** after the due date, otherwise not at all.
6. **Notice of the fee itself** (5-2-203(4)): the "late fee added" notice goes before the next due date, or the fee is
   shown on the next bill/statement — both happen by Rule 3 of this spec.
7. **Autopay**: the next auto-charge that includes the fee differs from the usual amount, so the customer gets the amount
   and date **at least 10 calendar days** before it (Regulation E for bank and debit; also used for credit cards). If the
   fee is recorded inside that window, it moves to the following bill (or a separate bill that is **not** auto-charged).
   The signed agreement, the Stripe bank mandate text and the saved-card terms must name the late fee; if the customer's
   signed version doesn't, **no fee** (To do instead).
8. **Agreement wording** (agreement template and signing page, English and Spanish with identical figures): the fee
   amount, that it applies once a bill is more than 10 days late, once per bill, can be waived, added to the next bill and may
   be included in that bill's automatic payment; plus the returned-payment fee if any (≤ $25 and only if agreed — none
   today). A test checks every template version carries these fields.
9. **Servicemembers**: a customer flagged "active military" (new optional field, never required) gets no automatic fee
   (To do for Chris) and pickup-after-default for them always needs a court order (OPS-6 refuses the consented-pickup
   path).
10. **Ended rentals**: a separate fee bill is never auto-charged after the customer's authorization ended.
11. **Records**: signed version, mandate/card terms, every notice, fee and waiver kept for at least the longest
    retention rule (OPS-7; ≥ 2 years).
12. **Before the first 6- or 12-month household rental**: owner checklist row "UCCC notification filing" (5-6-202); the
    rental wizard warns until Chris marks it done.

## Data and settings
Additive: `PendingCharge` (above), `BusinessSettings.lateFeeNoticeDaysBefore Int @default(2)`, `Invoice.lateNoticeDeliveryId
String?`, `Invoice.lateFeeDate DateTime?`. AR-8 catalog rows for the new setting. Backup: `PendingCharge` backed up.

## Tests
No notice → no fee and the To do; notice delivered → fee recorded on the fee date as a pending charge, overdue bill
amount unchanged; next local bill gets the line; Stripe path adds one upcoming invoice item (fake Stripe, idempotent on
retry); open bank payment → no fee; checkout started before the fee date → no fee; failed payment → fresh notice and
new fee date; paid on the fee date → no fee; waive before and after billing; once per overdue bill under two concurrent
runs; DST dates. Browser: the bill page shows "Late fee will be added to the next bill on {date}" / "Late fee waived".
