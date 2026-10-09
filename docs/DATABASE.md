# Database — plain-English guide

The full technical definition lives in `prisma/schema.prisma`. This file
explains *why* each table exists, in order, for whoever picks this up
next (human or AI). Money is always stored as **integer cents** (never a
decimal/float) — see `docs/BUSINESS-RULES.md`. Every timestamp is stored
in UTC and only converted to Mountain Time for display.

## Local isolated test database

Use `bash scripts/local-postgres-test.sh tests/<spec>.test.ts` for relevant
money, tax, schema, concurrency and authorization tests. The Vercel Sandbox
has PostgreSQL 18 binaries at `/usr/lib/postgresql/18/bin` (outside PATH).
The launcher creates a **new 127.0.0.1-only** `appliance_desk_test`, runs
migrations and test-only seeding, executes Vitest with `CI=true`, then stops
and removes only its temporary cluster. See [PLAYBOOK §4b](PLAYBOOK.md#4b-local-real-postgresql-testing-in-vercel-sandbox).
Never use Neon, Vercel preview or production data; CI's PostgreSQL 17 suite
is the final merge authority.

## Auth & people

- **User** — anyone who can log in: Chris (`OWNER`), any staff he adds
  later (`ADMIN`), or a customer (`CUSTOMER`). `role` decides what they
  can reach.
- **Session / Account / Verification** — Better Auth's own bookkeeping
  tables (login sessions, the hashed password record, email
  verification/reset tokens). Not hand-queried by app code.
- **Customer** — the business-side profile attached to a `CUSTOMER`
  user: phone, whether they're a business/property manager, a
  referral code (see `Referral` below), and `smsOptInAt` (Task #71 —
  real, recorded SMS consent, never assumed from having a phone number
  on file).
- **ServiceAddress** — a physical address a customer's appliances live
  at. A customer can have more than one (e.g. a landlord with several
  properties).
- **CustomerContact** — extra people on a customer account who are not
  logins (a property manager's maintenance lead, a tenant, the person who
  pays): name, role, phone, email, notes. Contacts never get portal access
  and never receive billing messages unless separately designed.

## Leads

- **Lead** — an inquiry from the public site's request form, or added
  directly by Chris for a phone call/walk-in (`createdByUserId` is set
  when staff added it, null when it came from the public form — see
  `docs/DECISIONS.md`'s 2026-09-29 "Adding a lead by hand..." entry).
  Holds everything the form captures plus the computed
  `score`/`scoreReasons` (see `docs/BUSINESS-RULES.md` for the scoring
  rules) and a `status` (new → contacted → converted / lost).
  `lostReason` (2026-09-29, CRM buildout) is required whenever `status`
  is set to `LOST`, free text.
- **LeadNote** — a per-entry contact-log line for a lead ("called
  Tuesday, no answer") — the same pattern `CustomerNote` gives
  customers, added for leads 2026-09-29 (CRM buildout) since a lead
  previously only had the one flat `Lead.notes` field.
- **LeadApplianceRequest** — which appliance types + quantities a lead
  asked for (a lead can ask for more than one kind of appliance).

## Inventory

T-6D1 (October 8): Each Appliance now stores explicit purchase-tax evidence:
`acquisitionTaxStatus` defaults to `UNKNOWN` on historical rows; optional seller
tax cents, seller note, scoped receipt Photo ID, timestamp and actor identify
subsequent evidence. A single additive migration leaves prior rental records
untouched. The existing Prisma-model-driven backup and schema-health traversal
automatically includes these scalar fields. Purchase tax rows and AuditLog
entries are written within the same inventory transaction; FILED worksheets
remain frozen and corrections are reviewed via the filing-amendment detector.


- **ApplianceType** — a category Chris rents (Washer, Dryer,
  Refrigerator, ...) and its *current* published price. Adding a new
  category is a data change, never a code change.
- **RentalPackage** / **RentalPackageComponent** (W-16A, 2026-10-09) — a set
  the owner defines ("Washer + Dryer Set" = 1 Washer + 1 Dryer) with its own
  monthly set price, website flag, order and photo. A set is never an
  appliance type and never one appliance: every machine stays its own
  `Appliance`. Components are (type, quantity 1–10), unique per type; any
  type works, including ones added later. Nullable `packageId` on
  `RentalLine` (package lines arrive in W-16B), `EstimateLineItem` (W-16B) and
  `LeadApplianceRequest` (a requested set is one row per machine type, all with
  the set's `packageId`). Packages are retired, never deleted (FKs restrict).
  Migration `20261013100000_rental_packages` turned the old "Washer + Dryer Set"
  appliance type into the package (price, flag, order, photo kept), pointed its
  quote requests at it and retired the type; signed agreements were untouched.
- **Appliance** — one physical machine: asset number, serial number,
  condition, current status (available/reserved/rented/maintenance/
  retired), and where it currently is. A washer/dryer "set" is priced
  together but is always **two** separately tracked `Appliance` rows —
  never one fake combined appliance — so swapping a broken dryer never
  loses the washer's own history.
- **OutOfServicePeriod** (W-21A, 2026-10-09) — a machine taken off a rental for repair with no replacement yet:
  agreement, line, appliance, `startedOn` (pickup date), `startJobId`, then `endedOn`/`endReason`
  (REPLACED | SAME_MACHINE_BACK | CLOSED_BY_OWNER), `endJobId`, `replacementApplianceId`, `creditId` (the
  `CustomerCredit` with sourceType `OUT_OF_SERVICE`). One open period per machine (partial unique index).
  `BusinessSettings.outOfServiceEscalationDays` (1–60, default 3). Migration `20261013110000_out_of_service_periods`.
- **AssetNumberCounter** (Batch C, 2026-10-03) — the next asset-number
  sequence per prefix (`WASH`, `DRY`, ...). Only moves forward, so a number is
  never handed out twice, even after a unit is deleted or renamed. Created
  and locked inside the same transaction that creates the units.
- **`PartRecord.quantityOnHand`/`reorderThreshold`** (2026-09-29,
  purchasing & supplies) — see `docs/BUSINESS-RULES.md`'s "Purchasing &
  supplies" section. Only moved by `receivePurchaseOrder` (up) and
  `recordPartUsage` (down) — never touched automatically elsewhere.
- **PartStockMovement** (Batch C, 2026-10-03) — the parts ledger. Every change
  to how many of a part Chris has on hand is one row here (opening balance,
  received, used, adjusted, recounted, reversal), with the balance after it
  and a cost that is blank when unknown. A database rule blocks changing or
  deleting a row; a mistake is fixed by adding a reversal. `PartRecord.quantityOnHand`
  is the stored total and always equals the sum of the part's rows. A retried
  save (same `operationKey`) returns the first result and changes nothing.
  Parts and suppliers with history are **archived** (`archivedAt`), not deleted;
  `PurchaseOrderLineItem.receivedQuantity` supports partial receipts and
  `unitCostKnown` says whether a line's price is real.
- **PurchaseOrderReceiptOperation** (Remediation R16, 2026-10-04) — one row per
  "these items arrived" request on a purchase order: the request's key (unique),
  the order, and a SHA-256 fingerprint of the order plus every submitted line
  (line, quantity, price or "unknown"). The row is created inside the same
  database step as the receipt, so a receipt that fails leaves no row. Sending
  the same key with the same lines again changes nothing; the same key with
  different lines, or on another order, is refused. This covers free-text lines
  that have no part (and so no stock movement) exactly like stocked lines.
  Receipts made before this table existed are still recognised by their stock
  movements or history entry. Deleting an order removes its rows. The table is in
  `BACKUP_MODEL_POLICY` (exported as `purchaseOrderReceiptOperation`); the
  migration is additive and does not read or change any existing row.
- **ApplianceCustodyEpisode** (Batch C, 2026-10-04) — who physically has an
  appliance. One row per stay at a customer: opened only by a completed
  delivery/installation (or a swap's new unit), closed only by a completed
  removal (or a swap's old unit). Renewals and agreement endings never touch it.
  A database rule allows only one open row per appliance. Dates are Colorado
  business dates; an unknown date is blank, never guessed (`startEvidence` says
  whether it came from a job, an estimate or the owner).
- **InspectionChecklistVersion / ApplianceInspectionAmendment** (Batch C, 2026-10-04)
  — the return-inspection checklist is kept as numbered versions (the highest
  is current). Each saved `ApplianceInspection` records the version it was
  answered against plus a copy of the questions, who passed it with an
  override and why, and the job it came from. A database rule blocks any
  change or delete of an inspection. A correction is a dated amendment row.
  `BusinessSettings.staffMayWorkUnassignedJobs` (default on) is the owner's
  choice about staff and unassigned jobs.
- **JobBillingHandoff** (Batch C + Remediation R1, 2026-10-04) — durable provider
  work written in the same transaction as job completion (start recurring
  Stripe billing or push a credit). A worker must first claim the row by moving
  it to `IN_FLIGHT` with `claimedAt`; only that lease owner may finalize it.
  Normal `PENDING`/retryable `FAILED` work gets up to five fresh attempts, but
  that ceiling is not a dead-letter rule: stale `IN_FLIGHT` leases are always
  recoverable, `BLOCKED`/`UNKNOWN` prerequisite or reconciliation waits use
  spare-capacity deferred rotation without consuming retry budget, and exhausted
  recurring-billing/credit handoffs may still finalize after a matching
  `ProviderOperation` proves the external Stripe write succeeded. `DONE` means
  both the provider/local reconciliation work and the durable handoff are
  finalized; no provider success is inferred merely because a function returned.
- **JobAppliance** also records the completion result (`result`, one per
  appliance), the swap role, and `reservationActive` (a staged swap owns the
  unit's reserved status; one per appliance). `Job.outcome` is COMPLETE or
  PARTIAL; `Job.completionKey` makes a retried completion harmless.
  `StaffTask` gains `applianceId` and `sourceKey` (a task a command creates for itself is made once).
- **Supplier** — a purchasing contact: name, phone, email, notes.
- **PurchaseOrder** / **PurchaseOrderLineItem** (2026-09-29) — an order
  placed with a `Supplier`, DRAFT → ORDERED → RECEIVED/CANCELLED. A
  line optionally ties to a `PartRecord` (`partRecordId`, nullable —
  free text otherwise); receiving the order adds each tied line's
  quantity onto that part's `quantityOnHand`.

## Estimates (2026-09-29)

- **Estimate** — a staff-created, custom-priced proposal for a deal
  that doesn't fit standard self-serve pricing (a property manager
  ordering for several units, a whole building, and similar — see
  `docs/BUSINESS-RULES.md`'s "Property managers / portfolio accounts").
  Belongs to a `Customer` **or** a `Lead` (`customerId`/`leadId` are
  both optional, but a `CHECK` constraint requires at least one — see
  `docs/DECISIONS.md`'s 2026-09-29 "Adding a lead by hand..." entry):
  an estimate started for someone who isn't a customer yet is tied to
  their `Lead` instead, and gets `customerId` filled in once they
  approve it online (both end up set at that point — `leadId` stays as
  a trace-back). Moves through `EstimateStatus` (DRAFT → SENT
  → VIEWED → APPROVED/CHANGES_REQUESTED/DECLINED/EXPIRED → CONVERTED),
  and records who actually approved it (`approverName`/
  `approverEmail`/`approverIpAddress`) the same way `SignatureRecord`
  records who signed.
- **EstimateLineItem** — one free-form priced line on an estimate
  (description, quantity, a monthly amount, a one-time fee, or both),
  optionally tied to one of the customer's `ServiceAddress` rows.
- **`RentalAgreement.sourceEstimateId`** — set when an agreement was
  created by converting an approved estimate
  (`src/domains/estimates`'s `convertEstimateToAgreements`); null for
  every ordinarily-created agreement. Purely a trace-back link — never
  read by pricing or billing logic, and conversion never copies
  `EstimateLineItem` rows into real `RentalLine`s automatically (see
  that function's own comment for why).
- **`Estimate.depositPaidAt`** / **`Estimate.followUpSentForSentAt`**
  (2026-09-29) — see `docs/BUSINESS-RULES.md`'s "Deposit collected at
  approval, and a follow-up if it goes quiet" section. The deposit
  payment itself is recorded as an ordinary `Invoice`/`Payment` pair
  with `Invoice.agreementId` left null (no agreement exists yet at that
  point — `agreementId` has always been nullable for exactly this kind
  of one-off charge).

## Rentals & pricing

- **RentalAgreement** — one signed (or in-progress) contract with a
  customer at a service address. Its money fields
  (`depositCents`, `lateFeeCents`, `taxRateMilliPercent`, ...) are a
  **snapshot** taken at signing — changing prices later in
  `/desk/settings` never changes what an existing customer owes. Can
  optionally trace back to the Estimate that produced it — see above.
  `taxRateMilliPercent` (also on `BusinessSettings`) is stored as
  thousandths of a percent — `7375` means 7.375% (the old
  `taxRatePermille` tenths column is deprecated: code never reads it, and a database trigger keeps it in step until a cleanup batch removes both) — see `docs/BUSINESS-RULES.md`'s
  "Sales tax" note for why. Batch B adds nullable renewal/auto-renew and
  early-termination snapshot fields; null means the owner policy has not
  been configured and the corresponding customer action must stay off.
  Remediation R1 adds nullable `firstDeliveredOn`: the durable Colorado
  business-date fact for the first completed delivery/installation visit where
  at least one rental item was actually delivered. It is written once and is
  the source for local agreement term dates and is recorded in Stripe metadata,
  so a later provider retry or reconciliation cannot move the local delivery
  fact. Remediation R1 deliberately does **not** backdate or re-anchor Stripe's
  recurring subscription calendar; delayed provider creation retains the
  pre-remediation charging behavior until a separately approved billing-calendar
  design proves amount/date equivalence. A zero-delivery visit leaves
  `firstDeliveredOn` null. Migration `20261004070000_remediation_r1_billing_lineage`
  backfills historical already-billed agreements from their existing
  `billingStartedAt` as the best-known approximation; agreements that never
  billed deliberately remain null rather than inventing a delivery date.
- **RentalLine** — one priced line on that agreement (e.g. "Washer/Dryer
  set @ $60/mo").
- **ApplianceAssignment** — which physical `Appliance` fulfills a given
  `RentalLine`, with a start/end so a swap keeps history for both the
  old and new machine.
- **PricingRule** — the audit trail of price changes over time (who,
  when, old value, new value) — separate from `ApplianceType`'s current
  price so Chris can see history in `/desk/activity`.
- **SignatureRecord** — the e-signature provider's record for one
  agreement (who signed, when, link to the signed PDF).
- **Deposit** — a security deposit tied to an agreement; see the
  Billing section below for its refund-tracking fields.

## Jobs (delivery / install / swap / maintenance visit / removal)

- **Job** — one scheduled visit: type, status, who/where/when, and
  before/after condition photos. Chris schedules every job by hand —
  there's no dispatch optimization. `dayOfReminderSentAt` (Task #71)
  dedupes the same-day SMS reminder.
- **Job scheduling columns** (Batch C, 2026-10-03) — `assignedToUserId` (who
  does the visit), `durationMinutes` (null = the owner's usual visit length in
  `BusinessSettings.defaultJobDurationMinutes`), `version` (counts changes so a
  stale screen cannot overwrite a newer one) and `noShowAt` (set when a visit
  was cancelled because nobody was there). Double-booking is checked only
  between visits for the same person.
- **JobAppliance** — which physical appliance(s) a job involves.

## Maintenance

- **MaintenanceRequest** — a customer-submitted problem report, its
  priority, the property the visit is for (`serviceAddressId`, filled
  automatically when the customer has one address), and its status
  (submitted → reviewing → scheduled → in_progress → resolved → closed;
  a cancelled or unfinished visit sends it back to reviewing).

## Billing

Redesigned for Phase 6B (docs/DECISIONS.md has the dated writeup) and
now wired up for real: signing an agreement creates a Stripe Checkout
Session, and Stripe's webhooks (`src/domains/billing/webhooks.ts`) are
what actually writes payment facts — never our own server merely assuming
money moved. See `docs/ARCHITECTURE.md`'s "Payments (Stripe)" section for
the moving parts.

Batch B adds a durable local financial/provider layer so a successful Stripe
call followed by a crashed process can be reconciled without creating the
same external object twice or losing the local link.

- **ProviderOperation** — one durable intent for every Stripe write that
  Batch B owns (customer/subscription create or cancel, balance credit,
  refund). The deterministic `idempotencyKey`, status, provider object id,
  attempts and sanitized failure make provider/local drift observable and
  recoverable (design D1/D2). `kind` is CUSTOMER_CREATE, SUBSCRIPTION_CREATE,
  SUBSCRIPTION_CANCEL, SUBSCRIPTION_UPDATE (moves a live subscription's end date when a renewal is signed or cancelled), BALANCE_CREDIT or REFUND_CREATE; `status` is PENDING,
  SUCCEEDED, FAILED, UNKNOWN or DRIFT; `subjectType`/`subjectId` name the local
  record it is about (for example `RentalAgreement` and its id).
- **Receipt** — one real-world payment event, whether Stripe or manual.
  One combined check is one receipt even when it is allocated across several
  invoices. `stripeChargeId` is unique for Stripe receipts so webhook replay
  cannot create a second receipt for the same cash (design D6). `source` is
  STRIPE or MANUAL, `method` is free text (card, check, cash...), `receivedOn`
  is when the money moved, and `recordedByUserId` is who entered a manual one.
- **Payment** — an allocation of a receipt to one invoice. It keeps the
  existing per-invoice shape and gains nullable `receiptId` for pre-Batch-B
  rows; the Batch B backfill links those historical rows (design D6). Its
  `status` is free text: `succeeded` (or the older `SUCCEEDED`) means the money
  applied, `failed` is an attempt, and `held` means a card payment that arrived
  after the invoice was written off or voided — recorded, applied to nothing,
  and not spendable until the owner decides (IN-23); once decided it becomes `succeeded` (marked paid), `held_to_credit` or `held_refunded`. The shared rule is in
  `src/domains/billing/payment-status.ts`.
- **CreditApplication** — an auditable, locked allocation of one
  `CustomerCredit` to one invoice. It is created together with the negative
  CREDIT invoice line and decrement of `remainingCents`, making double-spend
  prevention a database-backed transaction fact (design D7).
- **Invoice** — one bill, covering one billing period (billing is always
  *in advance* — see docs/BUSINESS-RULES.md). Has a human-facing
  `invoiceNumber` separate from its internal id, its own immutable amount
  snapshot, and Batch B's integer `version` for deterministic racing writes.
- **InvoiceLineItem** — one priced line on an invoice (rent, a fee, the
  deposit, tax, a discount, a later credit or correction), snapshotted
  at creation and never edited afterward. A partial unique database index
  now enforces at most one `LATE_FEE` line per invoice.
- **Refund** — money refunded from an already-paid invoice (a security
  deposit's own refund stays on `Deposit` below — different kind of
  money, its own existing record). Always has a reason and who
  authorized it; never automatic. `stripeRefundId` is set when the money went
  back to a card (backed by a REFUND_CREATE provider operation); a refund kept
  as account credit has no Stripe id and a matching `CustomerCredit` with
  `sourceType = REFUND_TO_CREDIT` and `sourceId` = the refund id.
- **CustomerCredit** — the local source of truth for an account-level
  credit. Batch B records its source (`sourceType`/`sourceId`/`side`),
  provider-delivery timestamp and per-invoice applications so a referral,
  refund-to-credit, or overpayment cannot mint or spend twice (design D3/D7).
  `@@unique([sourceType, sourceId, side])` allows one credit per source and
  side. `sourceType` values in use: RECEIPT_OVERPAYMENT, REFUND_TO_CREDIT and the
  referral reward types; manual credits have none.
- **WebhookEvent** — every Stripe webhook event this app has ever
  processed, by Stripe's own event id, so a duplicate delivery (webhook
  delivery is at-least-once) is never acted on twice.
- **Deposit** — a security deposit tied to an agreement, also recording
  who authorized a refund and why it was less than the full amount.
- **Referral** — links a referrer to one referred customer. Batch B adds
  `REWARDING` between `PENDING` and `REWARDED`: the row is claimed before
  credits are minted/provider pushes begin, so concurrent paid events cannot
  grant a referral twice (design D4).

## Batch T — official tax-rate metadata

- **TaxRateVersion** keeps its existing jurisdiction/rate/effective-date history.
  T-5b adds `autoApplied` and nullable `autoAppliedUndoneAt` so a future
  official rate can be identified as machine-applied and later undone without
  deleting the historical row.
- **TaxRateObservation** is non-PII proof that one official candidate rate was
  observed for one jurisdiction and effective date at a particular time. Two
  different Colorado calendar days are required before later T-5b work may
  auto-apply a candidate. Rows older than one Colorado year are pruned.
- **OfficialSourceWatch** is the registry/evidence row for official tax pages:
  label, unique URL, active switch, last hash/text/change excerpt, check/error
  timestamps and failure/review state. The six starting URLs are seeded
  inactive; this metadata PR performs no network fetch or automatic law/rate
  change.
- **BusinessSettings** adds `autoApplyOfficialRateChanges` (starting on) and
  `autoRateChangeMaxMilliPercent` (starting 1000 = 1.000 percentage point).
  T-5b1 only stores those owner-configurable defaults; later bounded work owns
  the guarded application behavior and T-7 owns the settings screens.

## Settings, content & compliance

- **BusinessSettings** — the one-row table behind `/desk/settings`:
  pricing defaults, fees, tax rate (starts at 0% with a warning until a
  CPA confirms the real rate), business info, service area, and the
  homepage announcement banner. Batch B's renewal/termination policy fields
  are all nullable by design: null means the owner has not established that
  policy and dependent customer actions remain unavailable rather than using
  an invented default.
- **SiteContent** — editable text blocks for the public site (headline,
  FAQ entries, etc.), keyed by a string like `"home.headline"`.
- **Photo** — an uploaded image (appliance condition, job before/after,
  maintenance report), always with an `altText` field for accessibility.
- **ConsentRecord** — records that a customer agreed to something (lead
  form privacy consent, SMS opt-in, a data export/deletion request) —
  required for the CCPA-style privacy work in `docs/BUSINESS-RULES.md`.
- **AuditLog** — who changed what, when, old value → new value. Powers
  `/desk/activity`.
- **StaffTask** — a staff member's own follow-up reminder (2026-09-29,
  CRM buildout), a note plus an optional due date, optionally linked to
  a `Lead`, `Customer`, or `Job` for convenience (all three foreign keys
  are `onDelete: SetNull` — deleting the linked record never deletes the
  task). Powers `/desk/tasks` and the "Follow-up tasks" panel on a
  lead's/customer's own page. Distinct from the automatically-detected
  exception flags in `src/domains/growth`/`src/domains/exceptions` —
  this is something a person chose to write down, not something the
  system inferred.

## What's *not* modeled yet, on purpose

Online self-service ordering and customer self-scheduling are
explicitly out of scope for launch (Chris approves every step by hand —
see `docs/BUSINESS-RULES.md`), but the shapes above (separate `Lead`,
`RentalAgreement`, `Job` records with clear statuses) were chosen so
those can be added later without a redesign.

## Prelaunch interest (2026-09-29)

- **LaunchSettings** — singleton with prelaunch-mode and email-enable switches,
  the owner-confirmed postal address for marketing footers, and reply inbox.
- **LaunchSubscriber** — opt-in local interest, normalized unique email,
  name/city/appliance interest/source, exact consent text/version/time,
  random 256-bit unsubscribe token, suppression timestamp, and sequence cursor.
  `deliveryBlocked` is an atomic claim before a send and stays true for an
  ambiguous/failed outcome so it cannot be retried blindly.
- **LaunchDelivery** — unique subscriber/step attempt, SENDING/SENT/FAILED
  status and timestamps. Subscriber deletion cascades to its attempts.
  The owner list selects only display fields and never serializes tokens.

Migration `20260930040000_prelaunch_interest` creates only these three tables
and their indexes. It does not rewrite or delete any existing business data.

## Team task assignment — October 1, 2026

StaffTask adds nullable assigneeUserId (User relation, SetNull on deletion),
TaskPriority LOW/NORMAL/HIGH (NORMAL default) and integer version (1 default).
The additive migration leaves every existing task unassigned and preserves links,
notes, dates and completion. Assignee/completion index supports Mine/Unassigned.
Version-checked writes and audit entries share one transaction; active actor and
assignee User rows are held FOR SHARE until commit so access removal cannot race
validation. Task links are fixed at creation and validated before creation.
StaffTask remains included in BACKUP_MODEL_POLICY; scalar exports include all
new columns. Generated schema-health checks read every scalar even for empty
tables; disposable CI's negative check now removes version and proves rejection.
Populated upgrade fixture proves old task defaults and record links survive.

- **RentalLineAmendment** (Batch C, 2026-10-04) — one row per permanently
  cancelled item: the line, the waiting item, previous and new monthly price,
  the date it takes effect (start of the next billing period), the reason and who
  did it. A database rule blocks any change or delete. `PendingDelivery` gained
  `substituteApplianceId` and `substituteJobId` (both set or neither) for a
  same-type unit set aside for the waiting item, and `refundedCents` /
  `refundByHandCents` (what went back through Stripe, and what the owner pays
  back by hand when the item was never delivered).

## Batch B2 lifecycle foundation — October 5, 2026

Migration `20261006010000_batch_b2_lifecycle` is additive. It introduces the
persisted facts the approved Batch B2 lifecycle design needs before behavior is
moved onto them:

- **SubscriptionEndIntent** — one versioned answer per Stripe subscription for
  whether billing should continue, end at a specific instant, or is already
  closed. The row also records the last version confirmed in Stripe, a short
  worker lease, retry scheduling and the last sanitized error. A later decision
  increments `version`; provider operations for an older answer can then be
  marked `SUPERSEDED` instead of winning a race after a newer decision.
- **RentalAgreement continuity fields** — `continuityRootId` identifies the
  first agreement in one uninterrupted rental and `continuousSince` preserves
  its first real delivery date. `monthToMonthTermsVersion` records which
  versioned month-to-month rules an agreement began on. The migration backfills
  a renewal chain from its root without inventing a delivery date.
- **MonthToMonthTermsVersion** — immutable numbered snapshots of the two
  month-to-month terms that can change after notice: how many days' notice is
  needed to end the rental and the customer-facing wording. Version 1 is seeded
  only when the existing settings contain both values.
- **CustomerNotice evidence columns** — legal delivery windows, the frozen
  recipient, provider message id and acceptance time, evidence date/channel,
  attempt fencing, retry/error fields and owner resolution facts. `status`
  intentionally remains a string because Batch B2's notice state machine is
  enforced in the domain layer.
- **LateReturnWaiver** plus `LATE_RETURN_WAIVER` invoice lines — the durable
  audit fact for a company-caused late pickup waiver. The original late-return
  charge stays visible and the waiver is represented as a matching negative
  rent adjustment rather than rewriting history.
- **EarlyReturnResolution** — one stored decision for a full return before an
  agreed ending (or before any ending was recorded): what happened to billing,
  unused paid days and any fixed-term fee, plus the resulting credit/refund
  references. This makes automatic/default handling reviewable rather than
  implicit.
- **BusinessSettings Batch B2 columns** — who may certify notice delivery,
  mail-transit days, the month-to-month change-notice period and starting
  customer wording, plus the four owner defaults for early returns. The live
  email and automatic-renew master switches remain unchanged and OFF.

All four new Batch B2 tables are explicitly included in `BACKUP_MODEL_POLICY`;
`verifySchemaHealth` automatically checks them because it enumerates generated
Prisma models. The migration's data steps are idempotent and are exercised on
real Postgres by `tests/batch-b2-migration-integration.test.ts`.

**Early returns (B2-19):** `EarlyReturnResolution` is one row per rental (unique `agreementId`) holding the decision and what
it did. Credits it creates have `CustomerCredit.sourceType = "EARLY_RETURN"`, `sourceId` = the resolution id. The audit row
`agreement.early_return_resolved` carries the full numbers and whether it recorded a new ending (`endingRecorded`), which a
later change of an automatic decision uses to take that ending back. `BusinessSettings.earlyReturnProrationBasis` is read again.

## Batch D control plane — October 5, 2026
Migration `20261007010000_batch_d_control_plane` (additive):
- `SiteContentRevision` — one row per version of the owner-editable website text (`fields` JSON holds only the whitelisted keys that differ from the built-in text). Status `DRAFT` (at most one open, never shown to the public), `PUBLISHED` (exactly one) or `ARCHIVED`. `version` is unique and only goes up. `restoredFromId` marks a revision that republishes an older one. `SiteContentPointer` (single row, id `published`) names the live revision and is the lock every save, publish and restore takes. The old flat `SiteContent` table is untouched and still unused.
- `DocumentArtifact` — frozen copies of signed agreements, invoices and statements, implemented in Batch D.
- `PrivacyRequest` — customer data export / deletion requests, implemented in Batch D.
- `BusinessSettings.legalApprovals` — which legal-page version the owner has approved, implemented in Batch D.
All four tables are in `BACKUP_MODEL_POLICY`; `verifySchemaHealth` checks them because it enumerates the models. `docs/SETTINGS-COVERAGE.md` records what happens to every `BusinessSettings` column. Profile extras are stored in the existing columns: `hours` `{mon:{open,close}|{closed:true}}`, `holidayClosures` `[{date,label}]`, `socialLinks` `{facebook,instagram,google,nextdoor}`, `logoUrl`.


## Batch E durable automation and messaging evidence

Migration `20261008010000_batch_e_messaging` adds four additive evidence tables. `AutomationRun` records one named automation pass per Colorado business-day slot (including stale/unknown recovery and owner pauses). `MessageDelivery` is Batch E's durable sender ledger: idempotency key, channel/purpose/template/recipient/subject, explicit provider outcome, provider id and timestamps. `ProviderEvent` deduplicates verified Resend/Twilio webhook events. `MarketingSuppression` stores one normalized address/channel suppression and its source. All four are included in `BACKUP_MODEL_POLICY`; generated schema health automatically queries every Prisma model.

The same migration adds launch-confirmation timestamps/token hash fields, `Lead.lastRealContactAt`, and the lead-scoring evidence contract: `Lead.scoringPolicyVersion` freezes which policy produced a saved score while `BusinessSettings.leadScoringPolicy` starts at version 1 with the exact pre-E weights. Saving a future policy must not silently rescore historical leads. `BusinessSettings.pausedAutomations` is the owner-controlled list used by the automation runner; pause/resume changes are audited and never delete run history.


## Colorado filing-workspace upgrade (Batch T-6a1, October 2026)

The additive `20261010120000_batch_t_filing_workspace` migration retains existing filing records and marks existing accounts as `SALES_RETURN`. Filing accounts now store configurable filing start, reminders, labels and license/check dates. Sales-tax and use-tax filing-account relations on jurisdictions are separate. Filing periods retain legal due dates, due-date edit attribution, payment evidence, zero-return status and entry progress. `TaxFilingAmendment` captures ordered correction packets with status and payment/filing evidence; it is included in the recovery manifest. No tax provider is activated by this migration. The separate Denver-local calendar helpers compute monthly, quarterly and annual boundaries, next-month base due dates and legal holiday rollovers; one-off proclamation/agency exceptions require owner verification and an explicit due-date override.


### Invoice issue-date evidence for Colorado tax filings (T-6b1)

`Invoice.issuedAt` stores an issue date independently of record creation. Stripe invoices record the provider's actual `status_transitions.finalized_at`, never webhook-receipt time, and missing provider evidence remains null. The additive `20261010130000_batch_t_invoice_issued_at` migration backfills non-draft/non-void local invoices from their creation time only; historical Stripe invoice dates must be verified and populated from provider records before accrual returns can be prepared. This is a filing-evidence integrity rule, not a change to customer charges or tax calculation.

### Batch T-7D database note

The Sales tax Overview adds **no tables or migrations**. It reads existing
TaxFilingAccount, TaxFilingPeriod, TaxFilingAmendment, TaxabilityRule,
OfficialSourceWatch, BusinessSettings and acquisition status records under
active team role checks. Setup indicator values do not modify ledger,
invoice, filing, payment or government authority evidence.


### System health issue records (S-1A)
`SystemIssue` is the private, deduplicated ledger of problems **with the system**
(not business exceptions or customer requests). Its `fingerprint` is unique;
`occurrences` increments on repeated evidence, and `version` advances with
record/reopen/resolve changes for later optimistic-concurrency owner actions.
`kind` is constrained to the approved event types. The issue summary and
technical detail are server-rendered from typed, allowlisted identifiers, not
raw exception text or provider responses. `SystemIssueNote` is private,
limited to 2 KB and at most one human/agent author identity. A free-text
note is never considered safe for an external agent export. Both models are
included in private backup/restore; API key material belongs to later S-2
and is intentionally not present here.


## Batch S-2 — revocable private AI check-up credentials

`OpsAgentKey` stores only the SHA-256 digest of a 32-byte random bearer token, an OWNER-supplied label, creation and last-use times, and a revocation timestamp. The bearer is returned only once from the owner action. The `SystemIssueNote.authorKeyId` reference is nullable and identifies structured agent notes, distinct from owner-authored notes. `OpsAgentKey` is excluded from database backup/privacy exports; the system-issue-note backup snapshot clears `authorKeyId` so a restored archive never references missing private credentials. Migration `20261012110000_batch_s_ops_keys` is additive, retaining all preexisting notes. This creates **no unattended agent**, external credentials or live provider activation.


## COM-L1a: independent SMS master switch

The additive `20261012120000_com_l1a_sms_activation` migration introduces `BusinessSettings.customerSmsEnabled Boolean @default(false)`. SMS may transmit only from a positively identified production Vercel deployment and when this OWNER-controlled switch is explicitly true; it never inherits `customerEmailEnabled`. Verified Twilio STOP and final durable SMS claims share one canonical-address advisory transaction lock, while the network call occurs after commit. An UNKNOWN SMS is never automatically retried. This stage does not enable outbound SMS or create paid provider resources.


## COM-L2 — telecom foundation (2026-10-09)

The provider-independent communications foundation is additive and initially **inactive**. `TelecomAccount` records the provider/environment/account configuration; `BusinessPhoneNumber` tracks provisioned numbers; `ContactPoint` and `ContactBinding` associate an SMS address with its owner or lead without inferring consent; `MessageAttempt` records independent send-attempt evidence. Existing `ConsentRecord`, `MessageDelivery` and `ProviderEvent` records retain their identities and history, with nullable links for later workflows. Processed legacy provider events are marked `LEGACY_HANDLED` rather than assumed successful.

These five new tables are included in backups. During restore, `MessageDelivery.currentAttemptId` is temporarily omitted and restored after message attempts are inserted, avoiding the legitimate circular foreign-key dependency. A populated, disposable PostgreSQL backup/restore test verifies the link survives. This schema does not authorize any Twilio calls, SMS sending, provider spending or customer messaging; live activation remains gated.


COM-L3 (threads, messages and template history): CommunicationThread groups a specified telecom account, business number and contact point without inferring customer/lead identity. CommunicationMessage stores encrypted inbound evidence or a pointer to the same-account outbound SMS MessageDelivery; provider identity stays account-scoped. CommunicationReadMarker stores a per-user cursor that can only point to a message in its own thread. CommunicationLink retains a source/actor and restricts business entity kinds to the approved set; domain authorization checks are deferred to the later contextual workflow. CommunicationTemplateRevision stores immutable text/policy by key+revision, allows one current version, and keeps a permanent key channel/purpose; a delivery template pointer is nullable for history and frozen after setting. Cross-account/thread/environment guards and backup dependency order are enforced in the migration. Nothing sends messages or activates a telecom provider.
