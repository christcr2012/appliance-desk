# What changed in the code after Batches C–F were designed

Batches C–F were designed on 2026-10-02, before Batch B was built. Batch B changed
some things those designs assume. **Read this file with each design's "Verify before
starting" table**, and add a dated line here whenever a merged batch changes a rule,
a name, a status value or a table that a later design relies on. This file is the
running answer to "does the design still match the code?"; the design drift check
(`docs/designs/README.md`) starts here.

Last updated: 2026-10-03 (after Batch B core merged, #147–#155; pickup/return billing added the same evening).

## Rules a later batch must follow

| Change (Batch B) | What a later design must do about it |
|---|---|
| **Tax is stored as `taxRateMilliPercent`** (thousandths of a percent, 7375 = 7.375%). `taxRatePermille` is deprecated, kept in step by a database trigger, and removed in a later cleanup. Use `src/domains/billing/tax.ts`. | Never read or write `taxRatePermille`. Any design text that says permille is superseded. |
| **Money events are Receipts; Payments are per-invoice allocations.** Overpayment becomes a `CustomerCredit`. | Cash reports and "collected" read receipts (`collectedBetween` in `src/domains/billing/collected.ts`; categories in `categories.ts`). Do not sum `Payment` rows for cash. |
| **Payment status is not one spelling.** Use `src/domains/billing/payment-status.ts` (`SUCCESSFUL_PAYMENT_STATUSES`, `isSuccessfulPaymentStatus`, `HELD_PAYMENT_STATUS`). Older rows say `SUCCEEDED`. | Never write `status: "succeeded"` in a filter or comparison. |
| **Held payments:** a card payment on an already written-off/voided invoice is a receipt plus a payment row with status `held`. No credit, invoice not reopened. | Anything that lists payments, balances or cash must treat `held` as "received but not applied". A settled one ends as `succeeded`, `held_to_credit` or `held_refunded` (constants in `payment-status.ts`); none of the last two is an applied invoice payment. Owner screen: `/desk/billing/held-payments`. |
| **Lock order for every money writer: customer (`lockCustomerLedger`), then invoices in id order, then re-read.** The Stripe webhook now follows it too. | New code that changes an invoice, credit or receipt must take the same locks, or it can race a write-off or a webhook. |
| **Business months are Colorado months** (`businessMonthBounds`, `businessDateKey` in `src/lib/business-date.ts`), not UTC months. | Reports and "this month" filters use them. |
| **Fixed terms start at delivery.** `endDate` is saved at the first billing attempt and sent to Stripe as `cancel_at`. Readers use `endDate ?? start + term`. | Do not recompute a term end from the signing date. |
| **Agreements carry a frozen copy of their ending/renewal terms** (`termsSnapshot`, frozen when sent for signing). Policy lives in Settings → "Ending and renewing rentals" (OWNER/ADMIN). | Customer screens show the agreement's own frozen terms, never the current settings. |
| **Provider writes go through `ProviderOperation`** (idempotency key, statuses PENDING/SUCCEEDED/FAILED/UNKNOWN/DRIFT). Read-only drift workbench at `/desk/billing/reconciliation`. | New Stripe writes use `runProviderCall`; new mismatch kinds are added to `detectDrift`. |
| **Tests that write the single business-settings row** must be listed in `SHARED_SETTINGS_TESTS` in `vitest.config.mts`. | Add new such tests to that list. |
| **CI:** 3 unit shards, 4 browser shards, one `ci` gate, secret scan; every new `e2e/*.spec.ts` needs a group in `e2e/shards.json`. | See `docs/ARCHITECTURE.md`. |
| **Pickup and delivery billing is built (2026-10-03, ahead of the Batch C design, at the owner's direction).** A completed REMOVAL job charges late-return days (`LATE_RETURN` line kind) for any pickup after the agreement's end date, whatever the status. A completed DELIVERY/INSTALLATION job records items staff tick as not delivered (`PendingDelivery`), and a later one credits the missing days (`CustomerCredit.sourceType = LATE_DELIVERY`, pushed to Stripe balance); "never delivered" removal credits every month billed (`unassignReason = "Never delivered"`). Jobs carry `performedOn` (the recorded work date). Settings in `BusinessSettings` (`lateReturnRateMode`, `lateReturnFixedDailyCents`, `lateDeliveryProrationBasis`, `pickupDayNotBilled`; `earlyReturnProrationBasis` is a dead column). `CustomerCredit.shownCents`/`shownOnInvoiceId` mark what a mirrored bill has shown. Rules in `src/domains/billing/pickup-billing.ts`. | Batch C's pickup/delivery design must build on this, not redesign it: the IN-24 company-fault waiver and the subscription rule for a missing item (delivered late or swapped same-type: line stays; permanently cancelled: line comes off from the next period — Chris, 2026-10-03) are the open pieces, both specified in `docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`. Item 14 of Batch C should treat these settings as the source of the daily rate, and `jobServiceDate` as the date any custody change happened. |

## Known name or location differences from the designs

| Design says | Code actually has |
|---|---|
| Batch D A2: `collectedBetween` in `src/domains/billing/categories.ts` | It is in `src/domains/billing/collected.ts` (`categories.ts` holds the category rules). |
| Batch D A2: `createRenewalDraft` (implied by "term/renewal functions") | Renewal drafting lives in `src/domains/agreements/term.ts`; verify the exact export before use. |

## Open Batch B items that change what later batches see

**Scheduled renewals (IN-22, merged in the scheduled-renewals PR).** `RentalAgreementStatus`
now has `SCHEDULED` (signed renewal whose start date has not arrived). It is NOT in force:
every existing `status: "ACTIVE"` filter (active rentals, MRR/ARR, billing, reminders,
reconciliation, appliance-ownership checks, portal) correctly excludes it. Batch C
availability and Batch D screens must not treat SCHEDULED as active, and may show it as
"renewal starting <date>". Appliances stay assigned to the old agreement until the start
date; `startRenewalInTx` (`src/domains/agreements/renewal-start.ts`) then moves the
assignments, the Stripe subscription pointer, next billing date, and deposit to the
renewal and ends the old agreement in one transaction (nightly cron
`/api/cron/start-renewals`; also run right after signing if already due). Ending or
cancelling a rental that has a waiting renewal is refused until the renewal is cancelled. New provider operation kind `SUBSCRIPTION_UPDATE` (renewal signed/cancelled moves the subscription end date); billing/reconciliation switch statements over provider operation kinds must handle it.
A renewal that cannot start raises the `RENEWAL_NOT_STARTED` exception.

Updated as the Batch B completion stack merges (`docs/STATUS.md`): scheduled renewals
(IN-22) add a "starts on a date" agreement state; held-payment resolution (IN-23)
adds owner actions on held payments; auto-renew/early-termination execution and term
notices (IN-21) add jobs and records. Batch C's inventory availability and Batch D's
customer screens must read these, not assume `ACTIVE` means "currently in service".

Auto-renew and early-ending execution (Batch B completion): `RentalAgreement.createdByAutoRenew`; invoice line kind `EARLY_TERMINATION_FEE` (statement group "Fees"); `ended` agreements can now be ended by the system with no staff actor (audit `userId` null); an early ending changes Stripe's `cancel_at` ahead of time; new exception `EARLY_ENDING_NOT_DONE`. Batch C pickup/return jobs must build on this (owner requirement IN-24 in `docs/PLAN.md` Batch C item 14); Batch D renewal/cancel screens read `terminationEffectiveOn` and the automatic renewal.

Notices (IN-21 part): new table `CustomerNotice` and screen Desk → Notices; an automatic renewal needs its reminder delivered before it starts (`NOTICE_NOT_SENT`); exception `NOTICE_WAITING` (owner/admin). Batch E (communications) should build on this table rather than create another.
All customer-addressed email goes through `sendCustomerEmail` (owner master switch, off by default); new customer emails in Batches D/E must use it. Auto-renew notice days are limited to 25–40.

**2026-10-03 (stronger-model Batch C update, `BATCH-C-UPDATE-2026-10-03.md`).** Physical custody must be a separate record that survives renewals (`startRenewalInTx` closes and recreates assignment rows without moving equipment) and agreement endings (`closeAgreement` closes assignments before pickup), so a later design must not tie custody to the renewable assignment row or to an ACTIVE agreement. Billing changes made by deliveries, returns, renewals, opt-outs and endings must all go through one shared billing-end contract that is still to be designed (PR #161 review findings R1-R4); Batch C must not add direct Stripe calls. Notice and consent rules from Batch B (email switch, reminder timing, owner-recorded delivery date, no blind retries) are baseline. Customer cash (`collectedBetween`) is not per-appliance earnings. Task priority is `HIGH` (no `URGENT`), tasks have `note` (no `title`) and no appliance link.

**2026-10-03 (Batch B reached `main` through PR #161, merge `b72f05d`).** What #161 added that a later design must know: (1) a second owner master switch, "Automatic renewals" (Settings → Ending and renewing rentals, default OFF, migration `20261003260000_auto_renew_switch`); while it is OFF nothing is queued, started or billing-extended automatically, though opt-out and early endings still work. Batch C and D screens must not assume automatic renewals are running. (2) `sendEmail` / `sendCustomerEmail` now return `{ sent, outcome }` with outcome `SENT`, `NOT_ATTEMPTED` (preview, no key, or owner switch OFF), `REJECTED` (provider refused; safe to retry) or `UNKNOWN` (lost response; may have been delivered, so never resend automatically). Any new customer email in Batch C or later must handle `UNKNOWN` the way estimate follow-ups and notices now do (record it, do not resend), and must not record a `NOT_ATTEMPTED` result as a delivery. (3) Turning the "Automatic renewals" switch OFF withdraws every queued automatic renewal at once (`cancelWithdrawnAutoRenewals`: billing stop dates are restored and the waiting reminders are withdrawn to `NOT_NEEDED`); turning it back on can requeue a withdrawn reminder with its saved wording. `PAUSED` is not a stored notice status: it is only a send-time answer that leaves a notice `PENDING`. A reminder past its 25–40 day window shows a "deadline missed" state on Desk → Notices, and the owner can record an owner-entered delivery date there. Nothing in #161 changes an assumption A2–A10 of `BATCH-C.md`; they were re-checked against the code at `b72f05d` (see the dated drift check at the top of that design).
