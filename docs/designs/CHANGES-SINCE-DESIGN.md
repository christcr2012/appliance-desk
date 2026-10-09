### T-7D tax overview review corrections

T-7D now filters obsolete returns within SQL before LIMIT, checks full
CPA-confirmed charge/jurisdiction coverage and a usable active sales-tax
filing account before showing a Recorded setup state. The Overview also
reuses Today's actual finance-tax exception items rather than
independently omitting license renewal, exemptions, refunds, pending
rate and Stripe/invoice tax evidence; the bounded summary links to Today.
No legal/owner payment or production tax activation was performed.

### T-7D — Sales tax overview and final engineering acceptance

The approved tax workspace finishes as one private Overview backed by a
bounded role-checked tax read projection. The six tabs lead to implemented
owner/admin tax work, while Today routes directly to real resolution pages;
neither a setup indicator nor a reminder is a billing/payments switch.
Local PostgreSQL tests cover non-activation, route resolution and stable
priority; browser-c includes phone/dark/axe and Today routing. No schema or
provider activation. Outstanding owner/CPA/GIS production questions are
explicitly tracked in OWNER-INPUTS and GO-LIVE-CHECKLIST rather than
represented as completed tests.

### T-7D — tax overview and action routing

The private OWNER/ADMIN tax overview now lists recorded global setup and
per-address verification separately from billing authority, ordered overdue,
amendment, due, blocked, setup and informational attention, nearest open return,
and current deadlines. Today's filing and license attention links go directly
to the shipped return and setup routes rather than looping to Today. UNKNOWN
appliance acquisition tax stays a visible review condition, not a disguised
paid use-tax answer. No finance posting, provider or legal activation occurs.

### T-7C PR #327 code review closeout

T-7C now treats credit/zero-tax amendments as handled-outside only (domain + UI), displays named full corrected filing totals and safe copy controls, and requires confirmation of irreversible owner filing/payment actions. Checklist keys are derived from step content rather than positional indices. Optional private filing uploads undergo a real Vercel Blob HEAD existence check outside the database lock before transaction-bound period ownership and Photo evidence claim; invalid or missing evidence prevents immutable finalization. The staff calendar denial test no longer follows a redirect to a 200 login response. Production filing/payment switches remain untouched.

### T-7C — guided tax returns and private evidence (2026-10-08)

After predecessor T-7B (#323), the tax workspace adds private filing list and guided period detail, separate SALES/USE/RDF packet tables, owner-only existing progress/filing/amendment commands, authenticated CSV/ICS exports and optional private evidence claim. Filed worksheets are displayed from immutable stored packets, with original-versus-corrected amendment review separate. The existing T-6C4 domain service owns filing/posting; the UI does not create a new tax calculation or activate filing/payments. Against main after #325, no T filing schema drift was found; unrelated K/M design changes were excluded from this PR.

### T-7B PR #323 review corrections

Owner/admin can verify a failed service-address match in the Areas workspace
using reviewed jurisdiction choices, an actor-audited existing domain command
and visible success/error feedback. FAILED official lookups remain in the
review queue. Official source-watch acknowledgement displays the HTTPS URL,
immutable change excerpt and exact hash+timestamp version, preventing false
success. Certificate links open the customer Billing tab and the existing
exemption panel. Real isolated DB/browser cases guard these corrections.

### T-7B areas and exemptions workspace implementation

OWNER and ADMIN can navigate current address-to-area evidence,
jurisdiction review, official source failures/changes, and previously
verified customer exemption certificates. Owner-only actions call the
existing authoritative manual-rate, automatic-undo and official-source
acknowledgement workflows. Neither unknown provider status nor
missing certificate evidence is represented as verified. New domain
queries use bounded stable keyset cursors and restricted financial DTOs;
the existing customer tax-exemption panel is the sole mutation surface.
This work is stacked on the reviewed T-7A head while #322 finishes CI.

### T-7A PR #322 review corrections

Saving a business tax address now invalidates prior current tax-area
evidence; re-verification is mandatory before purchase use-tax assessment.
Nullable "All state-collected areas" taxability defaults are editable by
OWNER. The account editor now covers §11.13 SUTS license expiry, account
area assignment/code/order/service fees, use-tax account routing,
deduction/screen wording, export capabilities, and review confirmation.
Filed-return area reassignment is guarded. The UI color-contrast and
mobile-menu inventory were corrected after first CI.

### T-7A implementation checkpoint (2026-10-08)

The new private `/desk/sales-tax` shell begins the six-tab finance navigation;
Setup and What's taxed are accessible now, and future routes remain
non-clickable until their cards ship. Owner-only transaction-scoped commands
whitelist business tax settings, filing accounts, confirmed taxability and
append-only rate history, enforce optimistic update timestamps, and audit
mutations. ADMIN has read-only pages; STAFF is denied access.
Existing BusinessSettings, TaxFilingAccount, TaxabilityRule, TaxRateVersion
and RDF rate tables are reused; there is no migration and no live activation.
The local PostgreSQL suite and browser-a phone/light/dark checks guard setup.

# What changed in the code after Batches C–F were designed

Batches C–F were designed on 2026-10-02, before Batch B was built. Batch B changed
some things those designs assume. **Read this file with each design's "Verify before
starting" table**, and add a dated line here whenever a merged batch changes a rule,
a name, a status value or a table that a later design relies on. This file is the
running answer to "does the design still match the code?"; the design drift check
(`docs/designs/README.md`) starts here.

Last updated: 2026-10-05. **The D, E and F designs were rewritten on 2026-10-05 against `main` 47bd833 with everything below already folded in**, and B2/E2 were written fresh against the same code. From now on, add a dated entry here when a batch merges (B2's section 8 lists what to add for it).

### 2026-10-08 T-6C3 code review fixes (#320)

Stripe fee webhook replay now joins each RDF line by `rdf_record_id`
→ `RetailDeliveryFeeRecord.invoiceLineId` rather than matching identical
fee amounts; description without durable metadata remains a normal rental
line. An unissued/untouched prepaid `OPEN` invoice may receive the RDF
fee, provided no customer-facing invoice artifact is frozen and no
payment exists. Added cases to the isolated PostgreSQL suite. These
adjustments are in the same PR to prevent a known money regression.

### 2026-10-08 T-6C3 engineering handoff (predecessor #319, main `1432585`)

New `rdf-charges.ts` prepares one collected fee from a `READY` original-sale
record; no new schema or tax rule. Local unsettled unissued drafts may receive
the fee; every immutable/paid/finalized/no-future-bill case gets a separate
manual-only invoice. Stripe subscriptions use durable `RDF_INVOICE_ITEM`
intents (`rdf-<recordId>`), SHA-256 payload evidence in `AuditLog`, explicit
zero fee tax rates, and metadata-linked invoice-line mirrors. Ambiguous writes
stay UNKNOWN and are inspected, not resent. Completion's agreement-before-RDF
lock order is preserved. The separately controlled
`RDF_CUSTOMER_CHARGING_ENABLED` switch is **off by default** until the owner
authorizes collection/go-live; this does not override CPA/Stripe/production
gates. T-6C4 uses `RetailDeliveryFeeRecord.invoiceLineId` for customer-collected
evidence, `deliveredOn` for filing period, and `saleOn` for rate selection.

### T-6C4 review corrections (PR #321)

Amendments now count new original RDF record IDs, not net fee difference
(which could offset a future-return credit); refund capacity is consumed
across all prior claim periods using frozen fee evidence; retail-sales year
ranges use America/Denver midnight, not UTC. The existing Today SALES_TAX
group gains an owner-facing customer-refund-needed item that links directly
to the customer's billing page. These findings were fixed before merge.

### T-6C4 implementation — 2026-10-08 (based on merged #320)

A standalone `RdfPacket` and `TaxFilingPeriod.worksheet.rdf` preserve
original statutory delivery fee evidence separately from sales/use tax.
`deliveredOn` selects the return; T-6C2's `saleOn` chose the frozen
rate. Worksheets freeze source amounts and whether the customer paid,
because a later `NOT_DUE` correction may clear mutable money fields.
Only a later open RDF return can credit a prior filed liability, and only
after a collected fee has a matching recorded customer refund. A preview
cannot reserve credits; filing and amendments lock/recheck original evidence.
Readiness calls the same recorded-retail-sales logic as the fee decision;
only applicable state-taxable Colorado rentals block on missing
handling/CPA confirmation. No paid resources or live filing activated.

## Current checkpoint — 2026-10-08, main b2a06c2 (#310)

A/B/C/R/B2/D/E/E2, F-part-1 and G are built; T is built through filing
finalization/amendments T-6b2. Use STATUS and MASTER-ROADMAP for current sequence,
not this file's older prospective wording. The documentation reset PR #311
adds no runtime behavior. It adds per-card/base drift checks, JIT authoring and
explicit T/S contract amendments; those future schemas are not yet shipped.
Near-term acquisition/RDF/tax-screen cards and S cards still require their real
predecessors. Later work has compact coverage, not re-verified execution cards.
The S/F/K/O acceptance refinements are in the existing designs; keep signed
facts/provider recovery/activation gates and verify them at implementation.

### Owner request after interrupted publication — October 8

V gains V-C1…V-C5 before visual composition: typed content/old-code adapter,
website assets, complete bindings/promotions, clear editor/publication/restore,
and compatibility proof. Existing D revisions/pointer remain; separate prices/
profile/catalog sources remain authoritative. O gains O-6/O-7 control center and
saved workspace; new O-7 preferences schema is future, not deployed. Required
acceptance IDs are pinned independently of card grouping. Runtime next remains T.

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
| **Pickup and delivery billing is built (2026-10-03, ahead of the Batch C design, at the owner's direction).** A completed REMOVAL job charges late-return days (`LATE_RETURN` line kind) for any pickup after the agreement's end date, whatever the status. A completed DELIVERY/INSTALLATION job records items staff tick as not delivered (`PendingDelivery`), and a later one credits the missing days (`CustomerCredit.sourceType = LATE_DELIVERY`, pushed to Stripe balance); "never delivered" removal credits every month billed (`unassignReason = "Never delivered"`). Jobs carry `performedOn` (the recorded work date). Settings in `BusinessSettings` (`lateReturnRateMode`, `lateReturnFixedDailyCents`, `lateDeliveryProrationBasis`, `pickupDayNotBilled`; `earlyReturnProrationBasis` was a dead column; Batch B2 (B2-19) reads it again for early-return refunds/credits). `CustomerCredit.shownCents`/`shownOnInvoiceId` mark what a mirrored bill has shown. Rules in `src/domains/billing/pickup-billing.ts`. | Batch C's pickup/delivery design must build on this, not redesign it: the IN-24 company-fault waiver and the subscription rule for a missing item (delivered late or swapped same-type: line stays; permanently cancelled: line comes off from the next period — Chris, 2026-10-03) are the open pieces, both specified in `docs/archive/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`. Item 14 of Batch C should treat these settings as the source of the daily rate, and `jobServiceDate` as the date any custody change happened. |

| **`InspectionChecklistVersion` (Batch D's D7 table) will be created by Batch C** (literal spec P2-E, review 2026-10-03), seeded as version 1 from the owner's saved checklist or the code default, with `publishedByUserId` nullable. | WU-D7 builds the editor and `publish` only; it must not add the table or a `BusinessSettings` version counter. Inspections carry `checklistVersionId` + a definition copy. |

## IN-28 (2026-10-04): subscriptions are created backdated to the delivery day

`startRecurringBillingForAgreement` now sends `backdate_start_date` (Colorado midnight of `firstDeliveredOn`, from
`subscriptionStartSecondsFor` in `subscription-term.ts`) and `billing_mode: { type: "flexible" }`. Batch D and C-09 must
assume Stripe's period start equals `billingStartedAt` (to within the daylight-saving hour), not the day the
subscription was created. Subscriptions created before this change may still start later.

## Remediation Batch R (merged 2026-10-04, #185–#197): contract changes Batch D and later must follow

Evidence for each is in `docs/reviews/2026-10-04-remediation-batch-r-acceptance.md`.

| Change | What a later design must do about it |
|---|---|
| **`RentalAgreement.firstDeliveredOn`** is the immutable Colorado date of the first real delivery, set once. A visit where nothing was delivered sets nothing and starts no billing. Stripe's own billing calendar is **not** moved to it (open owner question IN-28). | Read fixed-term dates and "first delivered" from it, never from a retry time. Do not promise customers that Stripe bills from the delivery date. |
| **Deposit refunds resolve through the immutable `Deposit.sourceReceiptId`** (the receipt that funded it), not through the agreement or the oldest payment. Manual deposits link a manual receipt and never create a Stripe refund. Ambiguous history stays unlinked and is not guessed. | Customer/owner deposit screens and any new refund path must call `resolveDepositRefundRail` (`src/domains/billing/deposit-provenance.ts`). Do not look up "the payment for this agreement". |
| **Webhook and provider calls never run under a database lock.** Stripe is read first (`src/domains/billing/webhook-evidence.ts`), then a short local transaction under the one global lock applies it; missing evidence is fetched outside the lock and replayed. | New webhook handlers must read provider facts from `WebhookEvidence`, not call Stripe inside the transaction. |
| **Estimate "valid until" = good through that Colorado day** (`src/domains/estimates/validity.ts`). Approve and request-changes refuse an expired estimate and mark it Expired. Input is strict `YYYY-MM-DD`. Sending is one locked claim with a saved `sentAt`; the email key is `estimate-send-<id>-<sentAt>`. | Batch D/E estimate screens and the communication ledger must use the same rule and treat `estimate.send_email_unconfirmed` (audit) as "delivery not confirmed". |
| **Owner/admin inventory commands are guarded transactions** (actor re-check, lock, validate, mutate, audit, all together): add units, edit details, add photo, start repair, retire, manual status, inspection. Staff keep only the job-scoped paths. | New inventory commands follow the same pattern; do not read the appliance or check the actor before opening the transaction. |
| **`PurchaseOrderReceiptOperation`** is the receipt idempotency source (key plus SHA-256 of every submitted line, free-text included). Creating an order and using parts follow the supplier-then-parts and part-before-cost lock orders. | Anything that receives or re-submits order lines goes through `receivePurchaseOrderLines`; the table is in `BACKUP_MODEL_POLICY`. |
| **Today reads are capped at 50 per category, oldest first with an id tie-break** (`getExceptionOverview` returns `truncated` totals; `getExceptions` returns the items). Term-ended and maintenance-due are computed in SQL. | New Today categories must be bounded the same way and report their true total. |
| **Appliance purchase date is stored as the start of its Colorado day** (`parseOptionalBusinessDate`). Repair costs are strict cents (`parseRepairCostDollars`, 0 to $100,000). | Reuse these helpers for any new date-only or repair-money input. |

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

**2026-10-03 (Batch C literal specification, `BATCH-C-LITERAL-SPEC-2026-10-03.md`).** Facts a later design must know: Batch C will add `Job.assignedToUserId/durationMinutes/version/noShowAt`, `AssetNumberCounter` (keyed by prefix), a parts movement ledger (`PartStockMovement`, append-only), `ApplianceCustodyEpisode` (custody no longer follows assignments or agreements), per-appliance job results (`JobAppliance.result/role`), `JobBillingHandoff`, `RentalLineAmendment` and a `SUBSCRIPTION_UPDATE` line-reduction operation for a permanently cancelled missing item. Completing a job will require a result for every appliance (bulk complete is removed). Batch D screens that show appliances, custody, parts or earnings must read these, not assignments or `collectedBetween`. Nothing here is built yet.

**2026-10-03 (Batch C scheduling and asset numbers, PR `ai/claude/batch-c-2-scheduling-assets`).** Built as the literal spec says: `Job.assignedToUserId/durationMinutes/version/noShowAt`, `BusinessSettings.defaultJobDurationMinutes` (Settings → Visits and scheduling), `src/domains/jobs/scheduling.ts` (`scheduleJob`, `markJobNoShow`, `findAssigneeConflicts`, `checkConfirmedConflicts`, `lockUsersForScheduling`), `createJob` now locks the actor and assignee first and calls `createJobInTx`, `findConflictingJobIds(jobs, defaultMinutes)` groups by person, and `AssetNumberCounter` with `allocateAssetNumbers` (`createApplianceUnits` is one transaction). Facts later designs must know: (1) every domain write to a job (`updateJobStatus`, `updateJobChecklist`, `setJobRepairCosts`, scheduling) adds 1 to `Job.version`, so P2-B's `completeJob` must too; (2) the dispatch board's candidate window is now 720 minutes either side, and `getDispatchBoardJobs` also returns `defaultJobMinutes`; (3) **date-time boxes are now read as Colorado clock time** through `businessDateTimeFromLocal` (`src/lib/business-date.ts`) — before this the server's own time zone (UTC on Vercel) was used, shifting new visits by 6–7 hours; any later screen that takes a `datetime-local` value must use it; (4) staff (STAFF) can read `scheduledAt`, `durationMinutes`, `assignedToUserId`, `version` and `noShowAt` of a job (operational fields, no money); (5) the asset-number allocator does not check the actor, like `createApplianceUnits` (the action checks the role).

**2026-10-04 (Batch C parts ledger, PR `ai/claude/batch-c-3-parts-ledger`).** Facts later designs must know: (1) all stock changes go through `applyPartMovementsInTx` (`src/domains/purchasing/ledger.ts`); never write `PartRecord.quantityOnHand` directly. (2) The new relations use `onDelete: Restrict`, so a part, job or order line with ledger rows cannot be deleted. (3) A purchase-order receipt uses one sub-key per line (`<key>:<lineId>`); a receipt on free-text-only lines has no movement, so its retry is detected through the audit log entry's `operationKey`. (4) `jobPartsCosts` decides a job's parts cost: any itemized USAGE row replaces the hand-typed `Job.partsCostCents` (reported as `source`); `setJobRepairCosts` refuses a hand-typed parts cost once usage exists. Fleet profitability uses it and carries `partsUnknownLines`. (5) `recordPartUsage` and `updatePartStockSettings` now require an `operationKey`. (6) Opening balances come from `PartRecord.quantityOnHand` at migration time only. (7) A usage on an archived part is refused.

**2026-10-04 (Batch C custody and completion, PR `ai/claude/batch-c-4-custody-completion`).** Facts later designs must know: (1) `ApplianceCustodyEpisode` is built (partial unique index: one open stay per appliance; DB CHECKs; opened by a DELIVERED result, closed by RETURNED; backfilled from history, unknowns marked `ESTIMATED`/`CUSTODY_UNKNOWN` exception). Custody survives renewals and endings; `startRenewalInTx` now locks moving appliances in sorted order. (2) `completeJob(userId, {jobId, expectedVersion, completionKey, performedOn, completionNotes, results})` in `src/domains/jobs/completion.ts` is the only way to complete a job: a result per appliance is required, a replay with the same `completionKey` returns the first answer, `Job.version` goes up by one, a blank date means today (Colorado), and a bad result makes a HIGH task via `createTaskInTx` (sourceKey `job:<jobId>:<applianceId>:<result>`). `updateJobStatus` no longer completes. (3) Billing follow-through is `JobBillingHandoff` rows written in the same transaction, run right after the commit and by the nightly `billing-reconcile` sweep (5 attempts). No new Stripe calls. (4) SWAP interim until P2-C: results are recorded, custody opens for a delivered replacement and closes for the original only if open (lenient), tasks are made, and no appliance status moves. (5) A delivered result on a job with no customer is refused before anything changes (choose the customer first). (6) Hand-made status changes enforce the custody rules (`assertStatusChangeKeepsCustody`): rented or awaiting pickup needs an open stay; available, reserved or retired cannot have one. Guided swaps now save the incoming unit as `REPLACEMENT`. (7) The driver screen sends "Mark complete" to the job page; there is no one-tap completion any more.

**2026-10-04 (Batch C swaps and maintenance chain, PR `ai/claude/batch-c-5-swaps-maintenance`).** Facts later designs must know: (1) `stageSwap` replaces `startSwapForAppliance`: staging reserves only the replacement (`JobAppliance.role = REPLACEMENT`, `reservationActive = true`); the original keeps its status, assignment and custody. `completeJob` for a SWAP does all the moves in one transaction (both results positive; neither moved; new delivered with old left behind) and refuses "old returned, new not delivered". (2) A reservation the swap owns is returned by `releaseSwapReservationsInTx` on cancel, no-show and `closeAgreement` (which also cancels a staged swap for the agreement). (3) `desk-access` `swapReplacementIdsFor` now reads `JobAppliance.role` (display only), and the job page no longer offers "Mark … as Rented" after a swap (completion does it); a STAFF member can still change the status of an appliance linked to a job through `updateApplianceStatusFromJobAction`, which P2-E tightens. (4) `MaintenanceRequest.serviceAddressId` (migration `20261003370000_maintenance_links`). `scheduleMaintenanceRequest` is the only way a repair visit for a request is created from the desk (the new-job form calls it when a request is chosen). The request follows its visit through `src/domains/maintenance/visit-sync.ts`: start → in progress, fully repaired → resolved, otherwise (not repaired, no access, cancelled, no-show) → reviewing unless another visit is open. `ALLOWED_TRANSITIONS` gained SCHEDULED→REVIEWING and IN_PROGRESS→REVIEWING. (5) Lock order used: customer ledger → agreement → maintenance request → job → appliances (sorted).

**2026-10-04 (Batch C inspection and job scope, PR `ai/claude/batch-c-6-inspection-permissions`).** Facts later designs must know: (1) The return-inspection checklist is now versioned: `InspectionChecklistVersion` (highest `version` is current; version 1 was seeded from the owner's saved list or the built-in one). `BusinessSettings.inspectionChecklist` is no longer read by anything. Batch D's checklist editor (D7) only needs to add a new version row. Each `ApplianceInspection` stores the version id and a copy of the questions; it can never be updated or deleted (database rule), and corrections are `ApplianceInspectionAmendment` rows. (2) `recordApplianceInspection(userId, applianceId, { expectedChecklistVersionId, answers, notes, condition, overrideReason, jobId })` works out pass or fail itself. A pass with unchecked items is an owner/admin override with a written reason (audit `inspection.override`). (3) `assertJobScopeInTx` (`src/domains/jobs/scope.ts`) decides what staff may do to a job: scheduled or in progress only (photos also after completion), assigned to them or to nobody when `BusinessSettings.staffMayWorkUnassignedJobs` is on (starting value on), and only appliances on that job. It is called inside the transaction of job status changes, photos, checklists, no-shows, completion, inspections and the staff appliance status change. A finished or cancelled job's checklist can't be changed by anyone. (4) The plain `updateApplianceStatus` and the bulk change now refuse staff inside the transaction. (5) Appliance and fleet screens label the number "Estimated rent (line price split evenly)"; a test fails if those modules import `collectedBetween`.

**2026-10-04 (Batch C missing item and subscription, PR `ai/claude/batch-c-7-missing-item-subscription`).** Facts later designs must know: (1) `RentalLine.monthlyPriceCents` can now go down after signing: when a waiting item is permanently cancelled, its share comes off the line from the next billing period and a never-edited `RentalLineAmendment` row records previous price, new price, effective date, reason and who. The share is the line price split evenly over the units that really count (not units that left as never delivered or replaced one-for-one). (2) `PendingDelivery.substituteApplianceId/substituteJobId` record a same-type unit set aside for a waiting item; the delivered substitute takes the original's place on the same line and the late-delivery credit counts to the substitute's delivery date. (3) The Stripe subscription is told through one recorded operation per cancelled item (`subscription-line-reduce-<waiting item id>`, kind SUBSCRIPTION_UPDATE, subject type RentalLine). (4) `closeAgreementInTx` and `runCloseAgreementContinuation` are the two halves of closing an agreement. Cancelling the last item uses them.
(5) Never-delivered cancellation refunds instead of crediting: `issueInvoiceRefund` was split into `prepareInvoiceRefundInTx` plus `runPreparedInvoiceRefund` so a refund can be recorded inside another transaction. `PendingDelivery.refundedCents` and `refundByHandCents` hold the result; `creditId` stays empty for a never-delivered item. Late-delivery credits are unchanged.

**2026-10-05 (Batch B2, PRs 1–4).** Facts later designs must know: (1) Billing ends through one contract: `SubscriptionEndIntent` plus the leased `applySubscriptionEnd` worker; every writer calls `recomputeForAgreementInTx` in its transaction and `applySubscriptionEnds` after commit. (2) Notices have seven states and an evidence date; a missed notice is never sent late (`src/domains/notices`). (3) Month-to-month terms are versioned (`MonthToMonthTermsVersion`); an agreement's effective version is its base version plus any newer version whose change notice was delivered long enough ago. Wording uses `{{placeholder}}` syntax. (4) `continuityRootId` / `continuousSince` are copied across renewals. (5) Closing after a full return and early returns live in `agreements/returns.ts` and `agreements/early-return.ts`; `refundAcrossPaidInvoicesInTx` is the shared "refund newest paid invoices first" helper. (6) Today has RETURNED_EARLY, NOTICE_* and kind-aware titles. (7) Any screen that ends or renews a rental must use `requestMonthToMonthEnd`, `requestEarlyTermination` or the early-return screen, never write termination fields directly.

## 2026-10-05 — Batch E implementation reconciliation

- Batch E reused the Postgres-backed public limiter already shipped before E; no second distributed limiter was added.
- Billing reconciliation records the real post-D passes and adds message-delivery reconciliation rather than recreating the obsolete `subscription-ends` assumption.
- Batch D's central metric registry remains authoritative; E updates custody utilization and real-contact definitions in place.
- Batch E11 closes the remaining business-audit surface with bounded Customer/Lead message history, explicit provider-state wording, public launch confirmation/unsubscribe limits, mailbox-confirmation consent evidence, an explainable custody + lead-pipeline demand estimate, and the provider-outage runbook.
- Live customer email/SMS/marketing activation remains outside this implementation and still requires the existing owner gates.



## 2026-10-06 — Batch E2 post-E drift reconciliation

- Batch E is fully merged. E2 starts from the final Evergreen token/accessibility code, generated route inventory, E11 messaging surfaces, and the D control-plane/metrics/privacy contracts; none are rebuilt in parallel.
- The E2 design's global radius/style lint assumption was stale against final `main`: hundreds of legacy `rounded-*` utilities remain on screens that the approved E2 plan explicitly migrates in E2-2 through E2-8. Applying the final guard globally in E2-1 would therefore collapse the remaining redesign into one oversized PR.
- At the owner's direction to use smaller PRs when needed, WU-E2-1 is split into E2-1A (tokens, lint foundation, contrast/accessibility proof), E2-1B (shared visual primitives and render tests), and E2-1C (structural, form and list components with render tests). This is a sequencing-only split; the approved E2 behavior and acceptance criteria are unchanged.
- E2-1A adds only brand-kit values already approved in BATCH-E2: navigation tokens and the 8px/16px radii. It does not change route behavior, data, permissions, live messaging, or payment activation.

## 2026-10-06 — WU-E2-6 drift reconciliation

- The E2 design still names `e2e/accessibility-authenticated.spec.ts`, but Batch E replaced that legacy file with the generated route inventory/accessibility shards plus `e2e/owner-portal-workspaces.spec.ts`. WU-E2-6 extends those current tests instead of recreating the removed file. The customer route inventory already includes the D-added settings/privacy surfaces; portal-home-only 390px coverage is added in the focused workspace spec to satisfy E2-9 without multiplying every customer route across an extra viewport.

## 2026-10-06 — WU-E2-7 drift reconciliation

- Batch D left a live `LaunchSettings.prelaunchMode` branch on the public home page. E2-7's “one home page” visual direction does not remove that business gate: both launch states are moved onto the approved Evergreen visual system, while the prelaunch state keeps its existing launch-list actions/copy and the live state gets the approved “Check your address” dominant action plus “See prices” text link. No launch state, legal approval, published-content, pricing, service-area, provider, or payment behavior changes.

## 2026-10-06 — WU-E2-8 drift reconciliation

- E2-2 and E2-6 had already implemented the E2-10 print-shell rule before WU-E2-8: owner/customer headers, side navigation and bottom bars are `print:hidden`, and `e2e/work-order-print.spec.ts` already verifies desk chrome/padding disappear at phone and desktop print widths. WU-E2-8 therefore validates that behavior rather than adding duplicate print CSS.
- The legacy `DeskSidebar` had no remaining imports, but several later-migrated screens still referenced `primaryActionClass`/`secondaryActionClass`. WU-E2-8 moves those callers to shared `Button`/`ButtonLink`, removes the aliases from `workspace.tsx`, and deletes the unused sidebar only after grep proves no live references.
- `docs/OWNER-GUIDE.md` contains no embedded screenshot assets to refresh. WU-E2-8 updates its current navigation/orientation prose; Batch F remains the final screenshot/handoff capture pass called for by the approved plan.


## 2026-10-06 — E2 public-site visual acceptance disposition

- WU-E2-7 / PR #262 passed its functional, accessibility, performance, and deployment gates and implements the approved E2-7 specification. During the required owner visual review, browser comparison against the existing production site showed that the overall composition remained too similar to the prior design. Chris judged the result visually unsatisfactory / insufficiently differentiated, but explicitly authorized #262 to merge so Batch E2 could finish. Treat the public-site visual quality as deferred follow-up work: the implementation is technically accepted, but it is not the final desired public-site redesign.


## 2026-10-06 — Batch F-part-1 start drift reconciliation

- Re-checked BATCH-F §0 against current `main` at `e640b75` after E2 and the CI/tooling PRs. F1-a's backup assumptions still match: exports are not snapshot-consistent yet, WebhookEvent is excluded, and no restore script exists.
- The schema currently has 70 Prisma models and its owning foreign-key relations form an acyclic dependency graph, so F1-a can derive restore order from the schema rather than maintain a duplicate hand-written ordering.
- E's low-level email/SMS senders do not expose test injection hooks. BATCH-F A4 already tells the implementer to add them if absent; because F-part-1 does not run provider-send scenarios, that work stays with F-part-2/WU-F3 instead of broadening F1-a.
- E2's final generated route/accessibility coverage and public-site acceptance disposition are already recorded above. They do not alter F1-a; F-part-2 screenshots/walkthroughs remain intentionally after G, T and V.
- The post-Batch-D recovery amendment remains binding: database restore preserves D control-plane rows; F1-b separately implements private-media recovery without resurrecting privacy-deleted bytes.


## 2026-10-06 — F1-c capacity/runbook drift reconciliation

- WU-F4's older file list says to “extend `tests/perf/fixtures.ts`”, but the merged Batch E implementation consolidated its original harness into `tests/perf/batch-e-large-lists.test.ts` and the dedicated `.github/workflows/perf.yml`. F1-c creates `fixtures.ts` for the new shared F capacity fixtures while preserving the existing Batch E harness.
- Normal CI now deliberately fails on skipped tests. The two database-heavy F capacity specs therefore join the existing Batch E perf spec on the explicit allow-list **only because all three run in the dedicated performance workflow**; the pure regression-guard tests still run in ordinary CI.
- Current owner reads are `getCustomerProperties` + the active-appliance query; the billing screen uses `getInvoicesCount` + bounded `getInvoicesPage`. F1-c measures those real read paths rather than raw SQL or a synthetic endpoint.
- Current recovery/provider contracts map cleanly to WU-F5: Stripe ambiguity is visible at `/desk/billing/reconciliation`, provider/message reconciliation runs in the 15:30 billing-reconcile pass, password reset has `revokeSessionsOnPasswordReset: true`, and staff deactivation deletes sessions transactionally. No decision-level drift was found.


## 2026-10-06 — Batch G start drift reconciliation

- F-part-1 does not change Batch G's agreement earnings, auth/session, or dark-token targets.
- Installed dependencies are still Next 16.3.6 and Better Auth 1.7.6. The lock still contains vulnerable `sharp 0.35.4` and `source-map-js 1.2.1`; their parent ranges permit patched point releases, so WU-G1 remains applicable and must not use a forced/major upgrade.
- Better Auth's 1.7.6-era two-factor schema is newer than BATCH-G section 2: verified enrollment and account-level lockout require `verified`, `failedVerificationCount`, and `lockedUntil`. BATCH-G now has a dated amendment matching the installed library and preserving its default lockout.
- Master Roadmap §7 assigns the batch's one migration to G-1 while G-2 owns two-step behavior. G-1 therefore creates all additive G schema but does not activate 2FA behavior; G-2 remains migration-free.
- `TwoFactor` is credential material and is deliberately excluded from F's recovery export alongside Account/Session/Verification; restored users must recover authentication instead of receiving restored TOTP secrets/backup codes.
- G-A6 was wording drift only: `store_...` is outside the repo scanner's infrastructure-ID pattern, so no preview-store secret allowlist change is required.
- Current close paths still match G-A2: `closeAgreementInTx` closes ENDED/CANCELLED, while renewal start directly ends the old agreement. Current earnings still cap only at `endDate`/as-of. Current dark semantic success/danger tokens still have no dark overrides. No other decision-level drift was found.


## 2026-10-08 — T-6D1 acquisition evidence compatibility (in implementation)
- `recordUseTaxForPurchase(tx, input, options?)` keeps its original default
  immutable-FILED rejection. Only the audited acquisition transaction opts in
  to corrected purchase facts while preserving FILED period/status and frozen
  filing worksheet; the existing amendment detector compares corrected facts
  to the saved packet. T-6D2 must preserve this explicit narrow opt-in.
- Incomplete purchase context yields typed
  `PurchaseTaxContextPendingError` with specific reason; arbitrary SQL failures
  still roll back. D2 should reuse the same typed review boundary.
- Do not mark this unit delivered until its PR has exact-head gates.

## 2026-10-08 — T-6D2 implementation drift (PR #314)
- Base is merged T-6D1 at `526de9a`, replacing the original design's pre-acquisition schema. Appliance acquisition evidence now exists, but invoices retain only `rentalLineId`; the billing-period-start assignment is therefore the canonical appliance lineage, not a client-provided exemption flag.
- Existing recurring Stripe setup applied the same tax rates to all items. T-6D2 now derives item-specific rates before provider creation. A mixed taxable/exempt asset set within one Stripe item is explicitly blocked rather than silently undercharged; separate items are required for that case.
- Existing prepaid invoices lacked `billingPeriodStart`; the signed date is now recorded as the period anchor. If no appliance is assigned at that instant, tax readiness blocks only the invoice rather than assuming an exemption.
- Filing previously marked purchase use-tax rows FILED without changing the appliance. The new status promotion requires an exact fully paid return and explicit sourceType=APPLIANCE mapping; underpayment and other-period rows cannot prove payment.


## 2026-10-08 — T-6D3 acquisition UI and consumer use-tax worksheet
- Baseline: merged T-6D2 at 5334e7d; the purchase-tax DTO and evidence fields exist. Inventory create supported optional purchaseTax but its owner UI did not expose it.
- OWNER-only intake choices with whole-quantity seller-tax amount; non-owner submissions omit evidence and server authorization rejects attempts.
- Configurable threshold default 30000 cents, prospective month-end frequency decision, and an explicitly non-official DR 0252 worksheet. Filing-account mutation and period partition remain future integration, not claimed as complete.
- Browser acquisition-intake accessibility coverage assigned to browser-a.

## T-6C1 completion baseline — October 8, 2026

Final prerequisite is merged #315 (`7ba2abd1`). Preserve its ADMIN read-only
packet projection and OWNER assignment/filing behavior while rejecting RDF
accounts from the sales/use-tax packet. New RDF enums also require the billing
ledger map, tax category map, backup manifest and actual populated upgrade/restore
proof. Downstream T-6C2 uses these current models/signatures; refresh its card at
the final #317 merge, not the earlier #310 baseline.

### 2026-10-08 — T-6C2 original-sale identity prerequisite

The existing `RentalLineAmendment` is a removal/price-adjustment record, **not** evidence of an accepted new retail sale. T-6C2 records original deliveries once as `agreement:<id>`; it deliberately does not mint `addition:<id>` identities from arbitrary delivery jobs or those removal amendments. Before any later feature makes chargeable additions, the accepted-addition transaction must provide a durable amendment identity and prove its own payment/authorization lineage; T-6C3 must not infer additions from free SWAPs. Prepaid sale date evidence is `Receipt.receivedOn`, **not** the webhook record `Payment.createdAt`. No customer fee charging is active.


### S-1B persisted source-evidence clarification (2026-10-08)
Verified against S-1A #330 and later Batch T merge #328/#329: the
address lookup's deliberate preserve-on-unavailable branch did not
persist the provider-health result. S-1B records an immutable,
customer-free `tax.lookup_source_health` audit outcome/day per actual
Colorado GIS attempt, counts distinct business dates rather than
in-memory attempts, and clears only on an observed source response.
Two later RDF reconcile rules are now explicitly registered for
automation health. The existing authenticated billing-reconcile cron
runs the bounded diagnostic sweep; no additional cron, database
migration, provider action, billing mutation or external AI access.

### W-0A purchase use tax — correction to merged T behavior (2026-10-09, #338)

On the verified #337 main baseline, no owner screen could confirm the private
business address, the same unresolved purchase-tax answer short-circuited, and
DUE purchases with no use-tax filing account had no resolution path. W-0A adds
manual owner/admin confirmation after advisory lookup, bounded idempotent tax
catch-up on setup changes and daily cron, explicit missing-prerequisite links,
and a high-priority Today alert for unlinked amounts. Account linking assigns
previously unlinked DUE rows only to OPEN matching periods, not FILED ones.
There was no migration, legal rate inference, customer message or payment.
The nonexistent `/desk/sales-tax/setup/accounts` route in the original card
was corrected to the real `/desk/sales-tax/setup#accounts` section.


### COM-L2 telecom foundation — 2026-10-09

- Additive migration `20261012130000_com_l2_telecom_foundation` preserves legacy email/provider events; processed legacy callbacks are marked LEGACY_HANDLED, not inferred APPLIED.
- Restore ordering treats nullable `MessageDelivery.currentAttemptId` as a second-pass relationship. `MessageAttempt` remains dependent on `MessageDelivery`; both foreign keys stay enforced. Populated real-PostgreSQL backup/restore verifies the lineage. No runtime sending, activation, or consent inference.


### COM-L3 schema guards (2026-10-09)
- Migration 20261012140000_com_l3_communications_threads adds five models, CONVERSATIONAL message purpose, composite account/thread/business-number and per-thread cursor FKs. SQL guards reject mismatched contact environment and outbound messages not backed by the same account's SMS delivery. L4/L5 must respect these.
- Template revision content and key/channel/purpose are immutable from creation; revisions may change approval/current selection. The one-current partial unique index and frozen MessageDelivery.templateRevisionId ensure historic delivery snapshots are never silently rewritten. L6A edits create a new revision. Old delivery revisions remain null.
- The five new communication tables are in backup policy with acyclic restore dependencies. No activation, spending or inferred consent.

### COM-L4A immutable preparation — 2026-10-09
- `src/domains/messaging/communications-policy.ts` defines strict schemaVersion 1 policy. The existing `customerSmsEnabled` master switch remains a distinct default-off prerequisite, independent of JSON; owner edits use an expected-version row lock and redacted audit evidence.
- `requestCommunication(actorUserId,input)` prepares SMS intent/MessageDelivery/MessageAttempt/CommunicationMessage/audit in one transaction with a canonical STOP lock and idempotency-key lock. Frozen body is AES-256-GCM ciphertext (server-only `COMMUNICATION_CONTENT_KEY`); request/content hashes are keyed digests, not plaintext in logs. A missing key, account verification, consent evidence or approved sender fails closed. No sending or provider API occurs here; L4B must recheck all gates and never automatically replay UNKNOWN attempts.
- For safety, COM-L4A rejects exchange-only and provider-keyword consent as general-purpose grant evidence: COM-L5 must implement exact inbound-exchange bounds, STOP/START projection and approved disclosures before such permissions become eligible. Production country verification likewise remains blocked until L4B supplies independently validated evidence. Existing legacy STOP suppression remains authoritative for all ordinary SMS.

### Batch W Amendment B — connected business (2026-10-09, pending IN-69)

Later batches inherit (`BATCH-W-AMENDMENT-B.md` section 11): **K** reads `Purchase` and allocated costs for the asset
register, depreciation and expenses; the audit pack's year view feeds the year-end package. **M** retires/sells single
machines (a "set" is two machines). **COM-L/COM-N** reuse the flow triggers S6, D1, E1, M2 for customer messages with
existing send gates. **BP** commercial bundles build on `RentalPackage`. **O** settings history covers the new settings
(out-of-service escalation days, unsigned follow-up days, record retention). Appliance types are single machines only from
W-16A on; "Washer + Dryer Set" is a package.

### COM-L4B provider claim and free destination validation (2026-10-09)
- `src/lib/communications/providers/twilio-sms.ts` uses installed Twilio v6, API key + secret, and an exact account SID match; adapter construction is limited to configured production. Twilio Lookup v2 **Basic** validation makes no paid data-package request (`Fields` never supplied), proves valid US country and E.164 identity; failed/unknown lookup blocks send.
- `dispatchCommunication` rechecks L4A account/policy/consent/STOP/actor guards immediately before claiming one PREPARED attempt. Status callback includes only the opaque attempt ID with owner-approved HTTPS origin. ACCEPTED/REJECTED/UNKNOWN/NOT_SENT evidence is preserved, monotone reducer prevents terminal downgrades, stale DISPATCHING is UNKNOWN rather than automatic resend. Provider is called after DB commit, not during locks.
- `communicationsPolicy.productionWebhookOrigin` is an optional strict HTTPS owner-controlled field. Missing field means provider not configured; existing default-off policy and SMS master gate are intact. COM-L5A handles verified inbound identity and callback matching; COM-L6A migrates the existing day reminder. No live activation.


### COM-L5A verified inbound SMS and privacy projection (2026-10-09)
- Dedicated `/api/webhooks/twilio/sms` enforces Node runtime, bounded original form input, SDK signature verified against the owner-approved canonical HTTPS URL (not Host headers), correct account/approved receiving number, durable receipt before empty TwiML 200. Unsigned/preview/invalid requests cannot produce an inbound message.
- `ingestVerifiedSms` stores one account-scoped inbound provider SID and encrypted CommunicationMessage per verified event transaction, including an unsupported-media marker without downloading MMS. Existing STOP handling still operates while the inbox gate is off; no reply is generated and broad consent is not inferred.
- `resolveInboundContact` uses only active verified bindings. Unknown => UNRESOLVED, shared => AMBIGUOUS, reassigned or previously ambiguous threads require explicit review instead of automatic takeover of prior history. Phone match never grants portal authentication or links jobs/property/agreements/invoices.
- New optional `communicationsPolicy.inboundSmsEnabled` is default-off and does not alter separate SMS owner activation. COM-L5B owns STOP/START/HELP consent projection and bounded inbound exchange reply scope.
- Preflight verified 34 affected and 14 focused unit/DB tests. This is stacked atop unmerged #354 until its missing final-head CI is satisfied.

### 2026-10-09 — W-0C: failed automatic charges enter To do (no migration)

Existing `invoice.payment_failed` webhooks now mark the mirrored invoice DELINQUENT
unless PAID/VOID and record a failed attempt within the idempotent event transaction.
To do's invoice attention filter includes DELINQUENT with no due date, PARTIALLY_PAID,
and overdue OPEN; its invoice-link destination is
`/desk/billing/customer/[id]/invoice/[invoiceId]`.
`pastDueInvoiceException` accepts nullable `dueDate` and optional `status` /
`attentionAt`; sorting uses latest failed attempt when there is no due date.
Later W workflow/screen work inherits these rules. No schema, late-fee clock, provider
activation or customer-messaging changes.

### 2026-10-09 — COM-L5B scoped consent implementation (no migration)

The already signed Twilio SMS endpoint now persists keyword evidence via
`projectVerifiedSmsKeyword`, including STOP/START/HELP while the inbox remains
default-off; app replies remain empty TwiML. Legacy STOP address suppression
continues; ambiguous customer-phone matches no longer select a random person.
START only clears provider-originated STOP when Advanced Opt-Out explicitly
reports START, and never creates GRANT. Existing prepared-send eligibility
continues to require newest purpose-specific scoped disclosure evidence.
`recordPortalSmsChoice` stores portal transactional-only version/hash/snapshot
in `ConsentRecord` within the customer preference transaction and revokes old
number consent on edits. No contacts are marked verified. The portal checkbox
imports the exact disclosure constant. No providers, live settings or schema
activated. COM-L6A inherits the consent rules and owns the richer messaging UI.

### W-16A rental packages — 2026-10-09 (#360)
- Schema (migration `20261013100000_rental_packages`): `RentalPackage` (name/slug unique, `monthlyPriceCents` ≥ 0,
  `showOnWebsite`, `sortOrder`, `isActive`, `photoUrl`), `RentalPackageComponent` (type, quantity 1–10, unique per type),
  nullable restrict FKs `RentalLine.packageId`, `EstimateLineItem.packageId`, `LeadApplianceRequest.packageId`. The old
  "Washer + Dryer Set" type is retired; its id stays on any appliance recorded under it (W-16B's split To do finds them by
  `applianceType.slug = 'washer-dryer-set'` and `isActive = false`).
- Code W-16B/W-21 reuse: `src/domains/packages/pricing.ts` (`packageSaving`, `separateTotalCents`, `machineCount`,
  `packageContents`, `validatePackageInput`), `src/domains/packages/index.ts` (OWNER/ADMIN writes with actor re-check,
  row lock, audit, `PricingRule` "<name> — set price"), `getPublishedCatalog()` in `src/domains/pricing/index.ts`.
- Leads: a requested set is one `LeadApplianceRequest` per machine type with the set's `packageId`;
  `summarizeApplianceRequests()` (`src/domains/leads/requests.ts`) shows it as one set. The lead form sends `packageIds`.
- Scope moved from the design table: website/quote form/leads came into W-16A (so retiring the set type and showing the
  package land together); the "split an old set appliance" To do + guided screen moved to W-16B.
- Until W-18 builds `<InfoTip>`/`<MoneyInput>`, the Sets screen explains with field help text and uses the existing dollar
  inputs; W-18 converts it with the other screens.

### W-16B set lines and old-set split — 2026-10-09 (#362)
- `addRentalLine(..., { packageId })` requires exactly one machine per part (`packagePartsProblem` in
  `src/domains/packages/pricing.ts`); price stays editable; renewals copy `packageId`. `addEstimateLineItem` takes
  `packageId` (active sets). Choices come from `listPackagesForLines()`; UI `src/components/desk/package-line-chooser.tsx`.
- To do category `OLD_SET_APPLIANCE` → `/desk/inventory/[id]/split`; `splitOldSetAppliance` in
  `src/domains/packages/split.ts` (existing row keeps history; new machines join the same rental line and custody stay;
  cost/seller tax split evenly). `OLD_SET_TYPE_SLUG` lives in `pricing.ts`.
- W-21 inherits: a line's machines are its active assignments; a set line is recognisable by `packageId`.


### 2026-10-09 — COM-L6A actual encoding, frozen template and reminder cutover
The shared SMS renderer handles GSM-7 extension escapes and UCS-2 surrogate
pairs, variable allowlisting and segment boundaries. Approved revisions compile
before immutable encrypted preparation and the exact decrypted content is
rechecked at the final dispatch gate. Read-only owner previews are under
Notifications. Existing day-of cron no longer invokes the legacy direct SMS
adapter; it returns held-for-review without a false sent timestamp.
COM-L6B must implement authenticated operator intent and job/thread approval
before sending can resume. No migration or live activation.


### 2026-10-09 — COM-L6B private SMS inbox and independent read cursors
Existing COM-L3 thread/message/read-marker schema is now used for
an actual authenticated owner/staff screen with bounded keyset
pagination, status/assignment filters, and server-decrypted private
message details. STAFF is limited to specifically assigned threads,
OWNER/ADMIN can assign, and mutations revalidate active team roles
in the write transaction. Read cursors never move backward or accept
cross-thread message IDs. Thread actions have optimistic version and
privacy-safe audit evidence. No schema, live provider or send activation.

### W-21A out-of-service periods — 2026-10-09 (#365)
- Migration `20261013110000_out_of_service_periods`: `OutOfServicePeriod` (one open per machine) and
  `BusinessSettings.outOfServiceEscalationDays` (default 3). The period stores `creditId` (design said
  `creditedOnInvoiceId`; the bill line is the existing Stripe-balance credit mirror).
- Job completion: a SWAP may now record old RETURNED + new NOT_DELIVERED ("taken for repair"); partial REMOVALs on an
  active rental open periods. `stageSwap` accepts an original with an open period. Credits: `CustomerCredit.sourceType
  "OUT_OF_SERVICE"`, pushed via `PUSH_CREDIT` handoffs (`runHandoffsByIds` export), labelled by the invoice mirror.
- `src/domains/billing/out-of-service.ts`: `openOutOfServiceInTx`, `closeOutOfServiceInTx`, `outOfServiceCreditPlan`,
  `resolveOutOfService`. To do category `OUT_OF_SERVICE`. W-21B adds the "done" decision on the same screen.

### W-21B set machine done — 2026-10-09 (#366)
- Migration `20261013120000_set_machine_done`: `RentalLineAmendment.pendingDeliveryId` optional, `outOfServicePeriodId`
  added, CHECK exactly one source. Unassign reason prefix "Taken off: customer done with it" is superseded for share maths.
- `src/domains/billing/set-machine-done.ts` (`planSetMachineDone`, `markSetMachineDone`, `singlePriceForRemaining`,
  `singlePriceStart`); credits `SET_SINGLE_PRICE`; Stripe `subscription-line-reprice-<amendmentId>` operations
  (`claimLineRepriceInTx`/`runLineReprice`/`retryLineReprice` in `subscription-line.ts`, reconciled in
  `reconciliation-base.ts`). W-19/W-20 (portal "next bill") should read these credits and amendments.
