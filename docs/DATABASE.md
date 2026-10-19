## K-6 additive book asset storage and source journals — pending migration verification

Migration `20261019010000_batch_k6_book_assets` adds `BookAsset` (FK to Appliance, original cost and in-service date snapshot, book life/salvage, durable `lastDepreciationMonth` even for zero-cent scheduled months, retired date/intent/book carrying value, version) and `BookTaxEvidence` (source-attributed append-only application records, CPA/tax evidence separate from management book numbers). SQL CHECK constraints validate months, cents, retirement consistency and CPA states. A seeded `RETIRED_PENDING_DISPOSITION` ASSET ledger role retains book value independently of `DISPOSAL_LOSS`. `system-chart.json` includes the new account for future installations. No existing acquisition history is silently overwritten by this migration.

Source journals are uniquely identified by `APPLIANCE` + `DEPRECIATION:YYYY-MM` or `RETIRED_HELD` through K-2 balanced journal rules; original source posting and role locks must pass first. Schema migration, DB test results, backups and real owner/accountant acceptance are not yet claimed green.

## K-5 immutable accounting export provenance — source in progress (October 18, 2026)

K-5 reuses existing `ExportBatch` + `ExportBatchEntry` (immutable bytes, SHA-256, creator and linked journal entries), `AccountExportMapping`, `JournalEntry`, `JournalLine`, and the JSON `BusinessSettings.exportPayoutLines` policy. The engine locks per target, checks source integrity and owner/admin database identity, and stores all journal IDs with the original bytes. Re-download checks the hash and never regenerates content from current account labels. Source-code implementation and regression fixtures do not represent deployed accountant trial acceptance. No new destructive migration is required.

## K-4A/K-4B expenses, privacy and recurring drafts — engineering in progress (2026-10-18)

Existing K-1/K-2 `Expense`, `ExpenseCategory`, `RecurringExpense`, `Photo`, `JournalEntry` and `PurchaseUseTax` records are reused without a destructive migration. Every posted expense uses K-2 unique balanced journal entries under the same Serializable transaction as its row lock and live team authority. Voids append a reversing entry and retain the original source; use-tax records remain governed by filed-return restrictions. A private Photo can be attached only after verifying the Blob store identity, exact expense-id path and submitter/owner role. Recurrence advances `RecurringExpense.lastCreatedFor` atomically with creating each draft, so retries and overlapping runs do not create duplicate drafts. A draft never initiates a provider payment. Finance source work still requires disposable-Postgres tests, all exact-head CI, checked release and independent provider/owner acceptance; do not confuse documentation with production acceptance.

## K-3 Stripe books import and clearing (engineering branch, October 18, 2026)

No new Prisma data model or business-source mutation: `StripeBalanceTransaction`, `IntegrationCursor`, `JournalEntry` and the owner-attested `BusinessSettings.booksStartDate` were introduced by K-1/K-2. The additive `20261018180000_books_stripe_clearing_issue` migration extends only the existing `SystemIssue_kind_known` CHECK with `BOOKS_STRIPE_CLEARING_DIFFERENCE` and preserves every previous kind and row. A unique provider balance id controls upserts; the import cursor advances only after all pages complete, while each stored batch is safe to replay. Provider data and opening Stripe balances remain private and backup-covered. The clearing check compares the same prior Colorado business-day cutoff against imported Stripe net movements and booked clearing debits/credits; missing owner opening evidence or source coverage returns UNKNOWN. The read-only Stripe import is inactive on deployment unless `BOOKS_STRIPE_SYNC_ENABLED=true` is separately authorized. No LIVE activation, production sync, financial approval or CPA reconciliation is implied by this source change.

## V-C4 and V-C5 website editor (2026-10-17)

No schema change and no migration. V-C4 adds publish/restore/discard rules over the existing `SiteContentRevision` and `SiteContentPointer` tables: publish takes the pointer lock and compares the live revision the owner reviewed; restore-to-draft creates a DRAFT revision with `restoredFromId`; discard deletes only an open DRAFT. Audit actions added: `site_content.restored_to_draft`, `site_content.draft_discarded`. V-C5 adds code and test fixtures only.

## V-C3 public website bindings (2026-10-17)

No schema change and no migration. Typed website values (version 2 revisions) already hold links, pictures and promotions; V-C3 only adds registry items (`src/domains/site-content/fields-public.ts`) and readers. Existing revisions read unchanged: items they do not mention fall back to the starting text or starting value.

## W-8 menu and W-9 filing autopilot (2026-10-17)

No schema change. W-9 reads existing TaxFilingAccount, TaxFilingPeriod and PurchaseUseTax rows and records through the existing `markPeriodFiled`; the new System health issue kind `TAX_PERIOD_MISSING` uses the existing system issue table.

## W-7 first-time setup checklist (2026-10-17)

No schema change. The Today "Get set up" card reads existing BusinessSettings, ApplianceType, RentalPackage, TaxFilingAccount and AddressTaxLocation rows; nothing is stored or written.

## W-14 / W-2 / W-15 purchase records (2026-10-17)

Additive migrations `20261017190000_vc1_revision_content_version` (V-C1: `SiteContentRevision.contentSchemaVersion` default 1, `templateVersion` nullable; existing rows read as version 1) and `20261017200000_vc2_website_assets` (V-C2: `WebsiteAssetState` enum and `WebsiteAsset` table). Additive migration `20261017170000_w17_cleaning_status` (W-17) adds the `CLEANING` value to `ApplianceStatus` (no new table; existing rows are unchanged). Additive migration `20261017150000_w19_unsigned_follow_up` (W-19) adds `BusinessSettings.unsignedFollowUpDays` (default 3, CHECK 1 to 30). No new table.

Additive migration `20261017130000_w5_w6_payment_link_and_lead_response` (W-5/W-6) adds `BusinessSettings.paymentLinkTemplates` (JSON, owner wording per reason, NULL = recommended), `BusinessSettings.leadResponseDays` (default 0, CHECK 0 to 14) and `Lead.nextFollowUpOn` (nullable date). No new table; all are covered by the existing BusinessSettings and Lead backups.

Additive migration `20261017120000_w4_rental_ending_notice` (W-4) adds `BusinessSettings.rentalEndingNoticeDays` (default 30, CHECK 1 to 365): the owner-editable number of days before a fixed-term rental ends that the Renew / Month-to-month / Pickup To do appears. No new table; the setting is covered by the existing BusinessSettings backup.

Additive migration `20261017000000_w14_purchase_records` follows W-25/W-26. `Purchase` is one receipt: seller (an existing `Supplier`, or a typed private `sellerName`; exactly one, enforced by a CHECK), `purchasedOn` (Colorado business date stored as that day's midnight), optional receipt `reference`, `subtotalCents` (the sum of the appliance prices), `sellerTaxCents` plus `sellerTaxKind` (`COLORADO`, `OTHER_STATE`, `NONE`, `UNKNOWN`) and `sellerTaxState`, `otherChargesCents` (delivery and similar, shown beside the receipt total but never added to machine cost or the use-tax base), `notes`, `operationKey` (unique per form, so a repeated save replays) with `payloadHash`, `taxRevisionAt` (compare-and-set for the tax answer) and the creating user. `Appliance.purchaseId` links each machine (nullable; older appliances keep none; `ON DELETE RESTRICT`). `PurchaseDocument` holds one private receipt page each (`Photo`, `pageOrder`, `kind`), unique per purchase page and per photo; its foreign key to `Photo` is `RESTRICT`, so a receipt photo a purchase points to cannot be deleted at all by any code path. `PurchaseOrderReceiptTax` records the tax answer for the parts on one purchase-order receipt (`answer`, `sellerTaxKind`, `sellerTaxCents`, `sellerTaxState`, `receivedAmountCents`, the priced `lines` JSON, `revisionAt`); its use-tax rows are ordinary `PurchaseUseTax` rows with `sourceType = PURCHASE_ORDER_LINE` and `sourceId = <receipt operation id>:<line id>`. `BusinessSettings.recordRetentionYears` (default 7, CHECK 1 to 50) is the owner-editable record-keeping period. All three new tables are in the backup manifest. Receipts live in private storage under `purchases/<form key or purchase id>/`; they are readable only by OWNER and ADMIN.

## W-25 phone-entered order provenance (2026-10-16)

Ordered additive migration `20261016190000_w25_phone_order` follows W-24. Estimate's
`phoneEnteredByUserId/phoneEnteredAt` identify an OWNER/ADMIN caller's ordinary
estimate, and `phonePreferredDelivery/phonePreferredAt` record only a **draft,
nonbinding** delivery choice and hookup/access details. No payment, signature,
visit, scheduling or credential state is implied. Current W-24 owner-offered
version and effective Denver date are validated in a serializable transaction;
the owner/client cannot use a stale option after revised offers. The normal
Estimate and its lead/customer, reviewed all-in/tax/route proof, signing and
provider-controlled payment remain the only monetary and contractual sources.
The existing outbound email consent/delivery gate is the only send path.
There is no new card, recording, telephone or messaging table.

W-24: additive migration 20261016120000 adds versioned customer delivery offers and readback for estimates and standalone agreements, owner-reviewed road-route evidence and unverified origin default, receipt-only requested visit, original confirmed date, first visit no-show evidence, customer TEST saved method, and idempotent owner-only trip/relocation fee provider-operation enum. No auto activation, public pricing or LIVE billing from the migration. Provider item tax is explicitly OFF absent a separately approved written exemption with TEST-only key; any unknown/taxable disposition remains disabled.

## W-23 postmerge privacy and import provenance (2026-10-15)

Additive ordered migration `20261016110000_w23_privacy_and_import_review` follows W-23's original `20261016100000` migration. `LocationContact.privacyHoldAt/privacyHoldReason` preserve held identities when legal claims/disputes need evidence, with role-limited, owner-attributed hold and audited release; former-contact erasure excludes any property with recorded maintenance requests as a conservative claim hold. `BusinessSettings.tenantContactPurgeApprovedAt/Reference/By` record externally obtained owner/privacy/legal review but do not activate deletion. Deletion requires independent deployment variable `TENANT_PII_PURGE_ENABLED=true` and the recorded review, with default deployment **OFF**. Owner-only dry-run counts and legal/case hold counts expose no PII. Do not set the activation flag or claim lawyer approval without the separate business-use gate and verified evidence.

New `LocationPortfolioImport` tracks stable customer-scoped SHA-256 normalized CSV digest, number of applied rows, approving owner/admin and date. Unique `(customerId,digest)` makes lost-response retries idempotent in the same SERIALIZABLE insert transaction; import preview and commit both check canonical address/unit collisions globally across customers, without exposing foreign-customer information. Its receipt is in the existing encrypted backup manifest. No existing financial/customer record is modified by this migration.

## W-23 tenant/site contacts schema (2026-10-15)

Additive migration: `prisma/migrations/20261016100000_w23_location_contacts/migration.sql` extends Customer with account contact permission and actor/time, ServiceAddress with `unitLabel`/private `accessNotes`/site override and provenance; adds LocationContact (scoped to ServiceAddress with current/past tenancy, nullable former-tenant PII, one-use repair-link hash); BusinessSettings defaults tenantContactRetentionMonths to 12 with a 1–120 database check. Existing paying Customer, rentals, invoices and appliance assignment relations remain untouched. Tenant contact does not carry User/login or payment linkage.

Migration is additive, but restoration must be tested with the existing backup + schema-health tooling on a throwaway database before publication. Never dump or log private access instructions, repair tokens or deleted former-person identifiers. Tenant retention erasure keeps only anonymous contact ID, scope and move-out timing; pending communications remain in existing customer notice tables. No SMS consent inferred from client permission.

## W-22FIN reviewed estimate fingerprint migration

Migration 20261014232000_preapproval_frozen_quote_identity adds nullable
Estimate.reviewedQuoteFingerprint, Estimate.reviewedOrderFingerprint and
Estimate.reviewedQuoteAt. Null means no reviewed all-in binding offer,
including historical preliminary estimates. Stored identities reference the
existing verified frozen signing order, not another charges ledger. Customer
approval recomputes both fingerprints under the Estimate lock, denying stale
packages, addresses, rates or policy versions. The stored identity cannot
prove counsel/CPA approval, a paid deposit, a signing receipt or an invoice
credit; these remain separately checked.

## W-22FIN mandatory-charge owner policy (October 14, 2026)

Migration `20261014223000_signing_mandatory_policy_versions` adds
`BusinessSettings.signingMandatoryPolicyVersions JSONB NOT NULL DEFAULT '[]'`.
This is an append-only, numbered, effective-dated configuration history for
owner-reviewed delivery, installation, removal, damage-waiver and retail-delivery
applicability, **not** a second money ledger or a chargeable estimate. Each
revision stores the recording owner identity, date, reason and individual
applicability decisions. The owner-only mutation serializes on the existing
BusinessSettings singleton `FOR UPDATE` and writes an `AuditLog` event
`signing.mandatory_policy_version`; role checks occur inside the transaction.
Invalid/missing or future-dated decisions resolve to `UNDECIDED`, never a
presumed charge or verified tax exemption. Older signed agreements, payment
receipts and invoices remain unaffected. The estimate owner-only preview
assembles existing machine/location/setup/down-payment amounts but continues to
fail closed on missing jurisdiction rules, statutory retail-delivery rates,
refundable deposit treatment and other mandatory charges. No customer-facing
binding quote, CPA/counsel approval or Stripe collection is conferred.

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

## W-22 setup charge tax category (2026-10-11)

`InvoiceLineItemKind.ADMIN_SETUP_FEE` maps to the dedicated
`TaxChargeCategory.ADMINISTRATIVE_SETUP`, never to rental or installation.
The two additive migration steps are deliberately separated: PostgreSQL
requires the added enum to commit before an `UNDECIDED` default rule can
refer to it, including through the transaction-wrapped backup restore.
The new default `TaxabilityRule` is explicitly `UNDECIDED`, and each
self-collected jurisdiction needs its own independently confirmed rule and
rate. This schema scaffold alone does not satisfy CPA decision IN-79, send
a tax-inclusive agreement, add Stripe tax rates or activate payment.

## W-22 setup-tax owner evidence and future revisions (2026-10-14)

The additive `20261015233000_w22_setup_tax_owner_approval` migration retains
all existing settings and introduces a **separate provisional** research-based
`BusinessSettings.setupFeeTaxPlanningTreatment` (starting `TAXABLE`). This
field **never** grants customer charge, agreement send or provider approval.

The independent business-use policy is `setupFeeTaxTreatment`, with
`setupFeeTaxDecisionNote`, `setupFeeTaxConfirmedOn`,
`setupFeeTaxEffectiveFrom`, `setupFeeTaxApprovedAt` and
`setupFeeTaxAdviserReference`. Old decided strings without actual
professional provenance remain unapproved. Only the OWNER can record
confirmation with explicit acknowledgement, dated evidence and a
traceable adviser reference; the existing settings optimistic lock, team
reauthorization and AuditLog preserve who changed what and when.
Saving `UNDECIDED` revokes the recorded approval; later effective dates
remain blocked until active. Historical signed snapshots, invoices and
completed payments are not rewritten. Independent verified address,
jurisdiction-specific taxability, rate, legal terms and provider gates
remain separate. Owner guidance changes affect eligible new drafts,
not already signed obligations. Missing evidence is a business-use
restriction, **not** a software development blocker.

The parallel \`SetupFeeTaxDecisionVersion\` records immutable successive
owner-approved tax treatments by Colorado-local \`effectiveFromKey\` and
\`cpaConfirmedOnKey\`, with decision note, adviser reference, approving owner
ID/time, and cancellation timestamp. New future-dated versions do **not**
supersede the current effective version prematurely; a revoked/undecided
version blocks affected new customer actions and cancels future successors.
The send-for-signature transaction rechecks the effective policy against
the frozen signing evidence under a shared settings lock; changes after freeze
cannot silently reach the customer. The separate legacy singleton fields
remain for UI continuity, not a substitute for the version history.

## W-22 owner-reasoned location setup fees (2026-10-14)

The additive \`20261015234000_w22_setup_fee_owner_overrides\` migration stores one
\`SigningSetupFeeOverride\` against the deterministic first agreement of each
service address in an order, never a customer-submitted cents field. Its OWNER
actor, reason, amount and audit history are stored; adjustment changes are
allowed only while every sibling remains DRAFT and no sibling has frozen
signing evidence. Updates remove every unfrozen prepared snapshot across the
order so the owner must review and prepare the revised amounts again.
Signatures, receipts and settled invoices are never repriced.

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
  W-21B (`20261013120000_set_machine_done`): `RentalLineAmendment.pendingDeliveryId` is now optional and
  `outOfServicePeriodId` was added — exactly one of the two is set (a never-delivered item, or a set machine the customer
  is done with).
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
  The additive `Invoice_createdAt_id_idx` compound descending index preserves
  stable newest-first billing list pagination without scanning and sorting
  thousands of rows (migration `20261015210000_invoice_created_at_id_sort`).
  The count and page APIs, invoice identity, and money fields are unchanged.
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


### COM-L7 voice metadata (additive, off by default)
CallSession maps a verified telecom account and business number to one
provider-root call, optional contact/thread, call outcome and routing
policy version. CallLeg stores independently keyed provider legs,
duration and answered/forwarding state. CommunicationMedia links a
provider recording ID to a private storage key, content hash, review
deadline and legal hold; a recording is not AVAILABLE just because a
provider webhook arrived. Database constraints reject public URLs in
privateStorageKey, impossible event times, negative durations, invalid
media lifecycle, and deletion under a legal hold. Retention review
never deletes media without independently approved provider, local
storage and recovery-copy cleanup. Schema tables are in the backup
manifest and no public media route exists. See COM-L7 card.


### COM-L10 — exact telecom usage, cost and statement evidence (2026-10-09)

Migration `20261013140000_com_telecom_cost_evidence` adds five
account-scoped tables without modifying any existing business row:
`TelecomSyncCursor` records the one per-account/resource paging checkpoint,
window, claim and outcome; `TelecomUsageSnapshot` appends provider GMT
category/date observations with source timestamp and content hash;
`CommunicationCostFact` preserves signed per-component amounts, distinct
ESTIMATED/PROVIDER_REPORTED/INVOICE_RECONCILED bases and optional
same-account revisions; `TelecomRateVersion` preserves exact observed
rates and bounded effective interval; and `TelecomStatement` tracks
private evidence, revision, owner verification and integer-cent statement
total. Cost amount, rate, usage and count use PostgreSQL DECIMAL(24,10)
via Prisma Decimal. Missing provider price is NULL, never zero. Only
the aggregate is rounded once to integer cents for display/reconciliation;
no floating-point money calculations, provider-side billing or booked
Expense is performed in this schema slice.

SQL CHECKs enforce valid date ranges, currency format, private statement
path/hash, verification state and safe cursor claim state. An account-scope
trigger rejects foreign business numbers, message attempts, call legs,
rates, statements and supersession across different telecom accounts or
cost classification/currency/component. Append-only source hashes and
unique scoped keys retain late provider corrections rather than overwrite
history; later domain write commands must still enforce immutable snapshots.
These five models are enumerated in `BACKUP_MODEL_POLICY`. During restore,
nullable `CommunicationCostFact.supersedesId` is restored in a second pass
after all cost rows exist (just like the previous
`MessageDelivery.currentAttemptId` deferred edge). This preserves a
deterministic, acyclic restore-table order and the DB scope trigger.

COM-L11 will implement read-only provider observations and transactional
cursor advancement, COM-L12 will reconcile comparable periods, and COM-N/K
will authorize owner-paid accounting only after independent evidence.
These tables alone do not enable SMS/calls, recording, invoice imports,
payments, cloud provider API sync or provider charges.

### W-1 — owner To do snooze evidence (2026-10-11)

Additive migration `20261014100000_w1_exception_snoozes` creates
`ExceptionSnooze`, keyed by a deterministic hash of an existing exception
identity (category, destination and when needed title). It records the
category, destination, reason, future snooze-until time, owner/admin actor,
and creation/update timestamps. The actor FK restricts deletion, and the
snooze deadline is indexed. Only a verified active OWNER/ADMIN may revise or
clear it; actions lock existing rows and append `AuditLog` entries, preserving
full snooze history without exposing customer message content. A snooze does
not change the business record, invoice, job, collection status, provider
message or deadline; once expired, unresolved To do items reappear. Backup
manifest explicitly includes the snooze model after `User`. One additive
migration, no destructive change or live activation.

### W-22A — signing-charge settings (2026-10-11)

`20261015100000_w22_signing_charge_settings` adds five columns to the one `BusinessSettings` singleton: `administrativeSetupFeeCents` (4500 default), `largeOrderMachineThreshold` (5), `businessRequiresDownPayment` (true), `setupFeeTaxTreatment` (UNDECIDED), and `setupFeeTaxDecisionNote` (optional). No historical agreement, customer, invoice, Stripe object or payment is changed. The owner-only settings action validates integer-cents inputs and CPA treatment, locks the singleton row to prevent simultaneous updates, checks the existing timestamp, and records an attributed audit log. The W-22B/C charge/credit linkage remains unimplemented and may not be assumed active. No destructive or data-backfill operation.


### W-22 signing-charge draft allocation (2026-10-11)

`AgreementSigningCharge` is one versioned, attributable signing-charge
preparation per `RentalAgreement`, protected by `agreementId` uniqueness
and restricted foreign-key deletion. Integer cents split administrative
setup fee and first-month down payment, with a checked subtotal and
`firstMonthRentCents`; source estimate/address reference, machine count,
tax-treatment status, settings timestamp, source fingerprint, actor and
optional freeze timestamp retain provenance. Draft plans are **not**
invoices/receipts/signed terms or proof of tax status or settlement.
The transaction service serializes preparation under agreement locks,
and the backup manifest preserves the child record. Migration:
`20261015110000_w22_signing_charge_snapshots`.

### W-22C5 frozen signing evidence

AgreementSigningCharge keeps the DRAFT allocation and, separately, nullable
frozenOrderFingerprint, frozenAllInCents, frozenSetupTaxCents and
frozenChargeEvidence (versioned per-agreement JSON jurisdiction/amount facts)
alongside frozenAt. The additive check requires all new frozen evidence fields
together, not partial additions. Existing frozenAt-only legacy test/records
are not silently converted to approved signing totals. The owner-only domain
transaction writes evidence atomically after independent CPA-category review.
This is NOT a Stripe receipt or signed contract; send/sign/payment readers
must reject absent/incomplete frozen evidence and verify its own provenance.

### W-22C6B signing-link proof

SignatureRecord's nullable signingOrderFingerprint, signingAllInCents and
signingEvidenceVersion retain what the recipient saw when the signing link
was issued. The additive database constraint prevents partially populated
new evidence while preserving existing historical signatures. Server-side
links with absent/incorrect proof are not accepted as valid W-22 signing
evidence; the new fields are **not** proof of payment or provider settlement.

### W-22C6C immutable signed-document amount provenance

SIGNED_AGREEMENT DocumentArtifact payloads created with W-22 frozen signing
offers now embed version, order fingerprint and exact per-agreement setup,
tax, down-payment and all-in cents. The content hash protects the canonical
HTML. Artifact recreation rechecks the source signing record against frozen
source evidence and refuses mismatches; previously sealed historical
documents are unchanged. This is contract evidence, not a payment receipt.

### W-22D4 signed payment obligation (PR #414)

`AgreementSigningPayment` stores one immutable signing-time **amount owed**
per agreement after the independently verified frozen offer is actually
signed. `agreementId` is its key and a restrict-delete FK; `orderFingerprint`
is the complete-order SHA-256 and `evidenceVersion` is 1. `setupFeeCents`,
`setupTaxCents`, `downPaymentCents` and `totalCents` are nonnegative stored
cents; a database CHECK requires their exact sum and a 64-hex-character
fingerprint. The row shares the original signed timestamp. `status` is
`AWAITING_PAYMENT` for a positive sum, or `NOT_DUE` for zero. The CHECK refuses
any invented paid/settled state until a reviewed, receipt-backed transition
is implemented in a successor. The signature and this obligation commit or
roll back together. Neither an obligation nor a signature is a payment receipt,
Stripe charge, deposit, credit or permission to deliver. This additive model
is in the backup registry; no historical signatures are backfilled.

### W-22D6 durable payment attempt reservations (2026-10-12)

`20261015160000_w22_signing_payment_attempt` adds
`SigningPaymentAttempt` as a child of `AgreementSigningPayment` (restrictive
foreign key). Each attempt records one signed per-agreement amount, immutable
order fingerprint, method (STRIPE_CHECKOUT or MANUAL), monotonically increasing
retry number and a deterministic, unique request key. A unique optional
provider object ID prevents provider references being reused across agreements;
database checks reject invalid cents, fingerprint, method and status.
The obligation remains `AWAITING_PAYMENT` when an attempt is merely
`PREPARED`. Neither a successful card charge nor an offline receipt is
implied by this table. Future provider settlement must independently verify
its own event and then record receipt/credit evidence; CPA IN-79 still blocks
unapproved live tax/payment activation.

For backups and restores, `src/domains/backup/manifest.ts` includes the new
model; restore parents (agreement and obligation) before its children. The
migration preserves all existing signed obligations and old records; no
backfill, activation, or destructive change occurs.


### W-22D8 — authenticated TEST settlement receipt (2026-10-12)

`20261015170000_w22_signing_test_settlement` adds optional receipt/settled-at
columns to `AgreementSigningPayment` and a unique Stripe PaymentIntent ID to
`SigningPaymentAttempt`. A PostgreSQL check allows `SETTLED` only with a
receipt ID and settlement timestamp; unpaid and waived obligations cannot
pretend to have receipts. The receipt links to the existing `Receipt` table,
whose unique provider charge ID also stops money being recorded twice.
Existing unpaid and waived records remain valid. No destructive/backfill
migration and no existing schema snapshot is silently reclassified.
The deposit/down-payment portion is **not** automatically credited to an
invoice; the next separately reviewed W-22 unit owns the exactly-once
invoice application. TEST evidence only, and never a LIVE activation.

### W-22D9 — settled down-payment entitlement (PR #421)

`20261015180000_w22_down_payment_entitlement` creates
`SigningDownPaymentCredit` with `agreementId` as primary key, unique receipt ID,
immutable frozen-order fingerprint, positive first-month down-payment cents
and creation timestamp. Restricted foreign keys bind both the actual rental
agreement and the `SETTLED` signed obligation and existing cash receipt. A
PostgreSQL insert trigger proves the same agreement, customer, settlement,
full receipt amount, frozen order hash and exact down-payment share; other
constraints reject duplicate entitlements. An UPDATE/DELETE trigger refuses
changes to credited entitlement rows, and source-record triggers protect its
settled receipt amount, customer, provider charge and accepted obligation
amount/fingerprint against relabeling. The `Receipt` row records the full
signing charge; the entitlement records **only its first-month portion**.
There is no new invoice `Payment`, `CustomerCredit`, `CreditApplication` or
Stripe customer-balance write. A subsequent approved W-22 step must apply
this entitlement to the correct first delivery invoice exactly once and
reconcile real provider application/readback before the UI claims credit.
No old invoice/signature is backfilled or modified. Backup manifest includes
the additive model. IN-79 and Stripe LIVE remain separately gated.

### W-22D11 — exact provider first-invoice credit application

`20261015190000_w22_signing_first_invoice` introduces the additive
`SigningFirstInvoiceApplication` table. Its agreement primary key and unique
Stripe subscription, invoice and invoice-line IDs are restrictive links to an
immutable `SigningDownPaymentCredit` entitlement. The SQL insert trigger
requires exact settled receipt, frozen fingerprint/cents and the rental
agreement's recorded matching Stripe subscription; UPDATE/DELETE are rejected.
No historical rent, credit, receipt, invoice or Stripe object is backfilled or
mutated by this migration. The backup registry includes the new child model;
restore agreement, obligation, receipt and entitlement before application.

The provider request includes exactly one negative, agreement-tagged
first-invoice item; after real invoice and line readback, the application row
records **provider credit application only**, not payment settlement. The
webhook mirror uses the exact negative invoice item as local `CREDIT`, refusing
early/foreign/duplicate/incomplete lines. A failed or uncertain provider call
is reconciled, never marked paid or automatically retried as a new charge.
Stripe LIVE, CPA IN-79 and all money-out/production gates remain unchanged.

### W-22D14 new hookup evidence

JobAppliance.newHookupItemsInstalled is a nullable Boolean. Old completed jobs remain NULL (unknown). True means newly installed items explicitly recorded at delivery, false means missing items requiring a machine-linked To do, and null means unrecorded. The existing JobAppliance resultRecordedAt and resultRecordedByUserId identify who and when. No direct billing, tax or parts inventory changes.

### W-22D16 — approved cancellation liability (2026-10-13)

`20261015220000_pre_delivery_cancellation` adds `BusinessSettings.largeOrderCancellationFullRefundHours`
(default 72, owner-editable 1–720) and one agreement-keyed `PreDeliveryCancellation`.
The record stores the reviewed source receipt/order fingerprint, refund/retention cents,
chosen policy, reason, affirmative terms review, approving user and timestamp.
`refundState=PENDING_EXTERNAL_REFUND` means still owed; `NOT_REQUIRED` means
no actual signing money was received. These are not Stripe refund states or evidence
that money was returned. Application code computes sums from locked provider-verified
receipt obligations, never from browser values. The model is included in backup
manifest coverage. Additive migration only, no historical backfill, Stripe money-out
or automatic customer notice.

### W-22D17 refund return evidence

Additive `20261015230000_w22_refund_reconciliation` extends one
`PreDeliveryCancellation` per agreement with nullable returned date,
recorded-at, approving owner ID, method, globally unique reference and
JSON evidence. `PENDING_EXTERNAL_REFUND` remains an unpaid liability.
`RETURNED_MANUAL_RECORDED` means the owner attested to a completed
external check/bank/cash return with a stored reference, not provider proof.
`RETURNED_STRIPE_TEST_VERIFIED` requires successful read-only Stripe TEST
refund evidence tied to the original charge and exact amount; provider
money-out is never invoked. History is not backfilled or marked returned.
Existing backup manifest for `PreDeliveryCancellation` covers new fields.

### W-22FIN historical cancellation classification (source-only, not acceptance)

Additive `20261016010000_w22_signed_cancellation_policy` stores optional signed
`AgreementSigningPayment.cancellationPolicyEvidence` and reviewed
`PreDeliveryCancellation.signedPolicyEvidence` JSON. At signature, after
verifying every frozen order sibling belongs to the same customer, a short,
shared policy lock freezes the original total machine count across addresses,
business/property-manager flags, threshold, owner policy revision timestamp,
window hours, customer/order fingerprint and actual signing instant.
The classifier never infers order size from a first-month advance; a prepaid
large order may have zero advance. Transaction rollback leaves no signature
if source evidence is incomplete. Existing obligations are **not backfilled**:
without signed classification, the reviewed cancellation only offers a full
refund, not retention under today's settings. Invalid non-null JSON requires
finance review. SQL triggers deny overwriting signed policy and reject a
cancellation whose policy differs from the signed obligation; legitimate
refund-return state may still be updated. No money-out, Stripe call, tax
decision, invoice credit or real contract-term approval is performed.

## W-22FIN draft commercial reserves and mandatory per-location fees (October 15, 2026)

The additive migrations `20261016020000_w22_commercial_reserve_terms` and
`20261016030000_w22_mandatory_service_review` add two JSONB arrays to
`RentalAgreement` with default `[]` for existing contracts:

- `commercialReservePolicyVersions` records successive OWNER-attributed
  per-address negotiated refundable reserve terms, amount, original estimate
  identity, quarterly/no replenishment choice, review reference, reason and
  revision date. `RentalAgreement.depositCents` remains the **only stored
  agreement reserve amount**; no duplicate deposit/receipt/revenue/credit
  ledger is introduced. Owner preparation now initializes each draft's
  reserve to zero instead of replicating an aggregate estimate deposit into
  every property. The owner must allocate the full aggregate **once** across
  the complete customer-owned prepared set before an eventual binding quote.
- `mandatoryChargeReviewVersions` records OWNER-only, reasoned, append-only
  per-address decisions for delivery, installation, removal and waiver,
  versioned effective owner settings, provisional per-jurisdiction fee tax,
  a single reviewed Colorado RDF event/rate/handling and corresponding reserve
  revision. It is an **internal planning record**, not a separately payable
  ledger or replacement for the original V1 frozen signing charge evidence.

PostgreSQL triggers prevent editing **new versioned commercial reserve**
amounts/terms once an agreement leaves `DRAFT`; legacy agreements with empty
commercial reserve history preserve their existing finance-correction behavior.
Other triggers prevent edits to non-draft mandatory review histories and
preserve every previously stored revision on a draft. All owner mutation paths
lock the estimate and its customer-owned agreements in a stable ID order,
check historical signing/payment/invoice/dispatch artifacts and stale revisions,
and write a reasoned audit. The initial migrations are additive; prior signed
agreements continue with empty policy histories (not invented approvals).

These arrays **do not satisfy** W-22FIN-QUOTE or enable nonzero deposits,
mandatory service/RDF amounts, legally unresolved taxes or customer checkout.
Until V2/future compatible frozen signing/receipt/cancellation/first-invoice
consumers are fully implemented and separately verified, the existing
preapproval quote still fails closed on unsupported mandatory categories.
CPA IN-79, counsel IN-07, owner approval and real Stripe TEST/production
acceptance remain independent. Never treat a `REVIEW_REQUIRED` JSON record as
actual professional approval or an authorization to send, charge or refund.

## W-22FIN V2 evidence migration (draft, October 15)

The unmerged W-22FIN implementation adds migration
`20261016040000_w22_signed_v2_components`: existing
`AgreementSigningPayment.componentEvidence JSONB` is nullable for historical
V1 records, while V2 must satisfy version-aware exact integer-cent
components, tax and total reconciliation. The field is immutable after
creation. No second obligation, invoice or credit ledger is introduced.

A verified V2 receipt may establish a separately refundable `Deposit`
liability with the same immutable `sourceReceiptId`. Only the rent advance,
never a deposit or service charge, can enter the first-invoice credit.

This draft migration has not completed disposable Postgres/rollback proof,
review or live deployment. It carries no live approval; V2 signing and
price-bearing acceptance remain blocked pending adviser approval and
complete refund integration. Existing V1 records retain their original semantics.

## W-22FIN exact-order business clearance and V2 compatibility

Forward migration `20261016050000_w22_business_review` follows V2 financial
components. `SigningBusinessReview` records immutable per-agreement revisions
of owner-attested received CPA/counsel advice, exact reviewed terms, effective
Colorado day and frozen order fingerprint. It cannot provide advice or imply
real provider acceptance. Missing, revoked, foreign, future-confirmed or stale
clearance fails closed at binding/collection boundaries. Owner revisions and
financial reads share the order-scoped transaction lock; financial mutation lock
order is agreement → obligation → review → receipt/reserve. The command locks and validates the active owner; SQL validates recorded identity,
monotonic revision and exact frozen source; update/delete is forbidden. Backup
policy includes these records and their existing agreement/user dependencies.

Unsigned reopening locks the editable source estimate and every agreement,
rejects any signature/payment/invoice/deposit/job or delivery evidence, archives
the complete prior frozen JSON in AuditLog, then clears the mutable freeze and
reviewed estimate identity. SQL protects accepted V2 snapshots against update or
delete. Restore orders AuditLog before historical reviews so archived unsigned
clearance remains restorable after reopening. Binding unsigned actions compare
the current settings version and independently recomputed jurisdiction taxes;
changes require a new freeze rather than silently adopting stale terms.

V2 signature constraints explicitly accept version 2 while preserving historical
V1 meaning. V2 obligation insertion checks its signature, immutable frozen amount
and JSONB component equality. Component CHECK validation returns false for missing
JSON rather than SQL NULL. Application and SQL independently reconcile cents,
component identities, reserve terms, tax categories and complete source revisions.
Nested canonical hashing is independent of PostgreSQL JSONB key order.

The same original signing receipt funds the reserve liability. Cancellation
approval does not discharge it; only independently confirmed return of the entire
approved cancellation amount discharges the included reserve. Generic deposit
refunds serialize with cancellation and cannot refund that reserve twice. Only
settled rent advance can reach first-invoice credit; all other signing categories
remain excluded. No migration, synthetic approval or test authorizes production
money-out or LIVE collection.

## W-26 — customer and quote language, controlled review, drafts (unreleased)

Forward-only migration `20261016195000_w26_customer_language` introduces
`Customer.preferredLanguage` and `Estimate.preferredLanguage` as nonnull
`String` values defaulting to `en`, with database `en|es` CHECK constraints.
Preexisting customers and quotes remain English. A valid public quote bearer
may change only its own `Estimate.preferredLanguage`; a currently authenticated
customer alone can update their `Customer.preferredLanguage`. Successful quote
approval or winning guarded signature transaction can record the customer's
chosen language, never an unrelated customer's preference or messaging consent.

`SignatureRecord.shownLanguage` is a nullable, checked `en|es` snapshot field;
historical signatures have NULL, while newly recorded signing evidence states
the actual legal language shown (`en` until separately reviewed translations
are authorized). No translation field changes frozen agreement terms, order
amounts, Stripe receipts, refund or invoice evidence. Do not infer a Spanish
signature from `Customer.preferredLanguage` alone.

`CustomerLanguageReview` is keyed by language and binds fluency and separate
legal evidence to the exact customer-copy SHA-256 digest. Its append-only
`CustomerLanguageReviewEvent` child records actual owner review actions and
evidence references. Runtime Spanish requires the reviewed digest, legal review,
owner publication, and independent completeness coverage of **all** quoted,
legal, signing, payment, portal, message and owner-template surfaces. The
source-stage deliberately fails closed on completeness even if reviewer records
exist. No reviewer actions or public Spanish activation are inferred from a
migration or passing synthetic test.

`CustomerTranslationDraft` stores private independently editable Spanish
versions of canonical published-English website text and current communication
templates. Its unique `(sourceKind,sourceKey)` binds `SITE` or `COMMUNICATION`
to a SHA-256 of the actual English source; `revision` guards competing editors;
`editedByUserId` and the existing AuditLog retain attribution. Stale drafts
cannot silently follow changed English text and drafts neither publish
website revisions nor send communication. Backup manifests include W-26 tables.
The initial migration was proved on **disposable local PostgreSQL only**; no
production migration, LIVE payment activation, customer signing or provider
acceptance is authorized by this paragraph.

W-26 continuation also freezes `SignatureRecord.interfaceLanguage`,
`translationCopyDigest` and separately informational `informationalTerms` JSON
without changing the English governing signature. A PostgreSQL trigger rejects
updates to these fields or `shownLanguage` once signed; prior rows are not
translated or backfilled. `CustomerNotice` and `MessageDelivery` carry a default
English content language and optional source fingerprint for new localized
submissions. New notices retain the original English legal text; dispatch checks
current approval before a new Spanish submission, while durable prior provider
acceptance can still reconcile after approval is withdrawn. Existing history is
never regenerated from the customer's current preference.

Translation source kinds also include `MESSAGE`, `NOTICE` and exact-English
`LEGAL` hashes. Original-message variables must be preserved. Current canonical
English, Spanish revisions, static/dynamic customer copy and consent disclosures
are all included in the review fingerprint; source drift invalidates publication.

New `SigningPaymentAttempt.checkoutLocale` freezes the reviewed language on the
original durable attempt. Retries reuse it with the original idempotency key;
existing attempts retain NULL and omit the previously absent provider parameter.
A withdrawn Spanish approval blocks new Spanish provider submission. Historical
legacy Checkout parameters stay unchanged; Stripe handles its own browser locale.

`QUOTE` drafts also bind independently edited owner quote notes to their exact
English source hash. Quote pages and outgoing quote mail use the reviewed note
or wholly English output; the stored note and monetary quote evidence are not
rewritten. Arbitrary product/customer data and historical documents remain exact.

## Batch K books foundation — October 17, 2026

The additive Batch K tables are LedgerAccount, AccountExportMapping, JournalEntry, JournalLine, AccountingPeriod, StripeBalanceTransaction, IntegrationCursor, ExpenseCategory, Expense, RecurringExpense, ExportBatch and ExportBatchEntry. Journal entries have a unique (sourceType, sourceId, eventKind) and their lines must use nonnegative integer debit or credit, never both. Existing invoices, payments, customers and tax records are unchanged. The migration seeds non-destructive chart roles, per-filing-account tax liabilities and 16 expense categories; saved owner account names are not overwritten by later synchronization. Backup and restore retain all 12 models. Financial posting itself is intentionally not live until K-2A.

## K-2 accounting controls

The poster writes atomic journal entries with one unique (sourceType,sourceId,eventKind). Month posting and closure share a PostgreSQL transaction-scoped advisory lock; closed-month backfill gets next-open-month date and lateForDate. The additive migration extends the strict SystemIssue kind allowlist to recognize BOOKS_POSTING_FAILURE without changing existing rows. No source billing records are modified. Owner starting balances are single-use and audit logged. No provider credentials or production data are involved in local tests.
