# Package 2 Audit — Agreements, Pricing & Referrals

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope authority:** `docs/AUDIT_ROADMAP.md` Package 2  
**Status:** Audit complete; remediation not yet implemented by this report.

---

## Executive summary

Package 2 covers rental-agreement lifecycle behavior, agreement pricing snapshots and owner-configured pricing rules, referral reward behavior, concurrency/idempotency around those workflows, and the Stripe interactions that directly determine agreement billing and referral reward eligibility.

The current implementation has several strong foundations: atomic physical-appliance reservation, deterministic/idempotent draft creation, immutable rental-line pricing snapshots, guarded duplicate signing, STAFF finance isolation, and a sensible referral-code model.

However, the audit found serious integrity gaps at the boundaries between agreement state, Stripe state, and referral credits. The highest-risk defects can create contradictory agreement state, orphan or lose control of a live Stripe subscription, duplicate referral value, split one Appliance Desk customer across multiple Stripe customers, or make a normal draft-line removal fail against the real database.

### Overall assessment

**HIGH RISK until remediation.**

| Severity | Findings |
| --- | ---: |
| Critical | 4 |
| High | 8 |
| Medium | 5 |
| **Total** | **17** |

The remediation should be implemented in a few coherent changes rather than one PR per finding. Real Postgres concurrency/integration tests are required for several findings because mocked Prisma calls cannot expose database constraints or real transaction races.

---

# Critical findings

## C1 — Agreement lifecycle mutations do not share an atomic state claim

### Affected areas

- `src/domains/agreements/index.ts`
- `src/app/desk/agreements/actions.ts`
- `src/app/sign/[id]/actions.ts`
- `tests/agreements-sign-concurrency.test.ts`
- future renewal/termination operations

### Problem

Multiple agreement mutations validate agreement state before the transaction that performs the mutation, rather than atomically claiming the expected lifecycle state inside the mutation transaction.

Examples include adding/removing rental lines and sending an agreement for signature. The signing path has a good conditional claim on `SignatureRecord.signedAt`, but that protects duplicate use of the signing link; it does not conditionally claim the agreement's `AWAITING_SIGNATURE` state.

This permits races such as:

```text
Request A: addRentalLine reads DRAFT
Request B: sendForSignature reads DRAFT
Request B: agreement becomes AWAITING_SIGNATURE
Request A: transaction adds another priced rental line
```

The customer can therefore receive a contract whose pricing/equipment terms can still change afterward.

A more dangerous race exists between signing and cancellation:

```text
Sign reads AWAITING_SIGNATURE
Owner cancellation reads AWAITING_SIGNATURE
Cancellation frees reserved appliances and marks agreement CANCELLED
Sign transaction later writes agreement ACTIVE
```

That can create an ACTIVE agreement whose appliances have already been released to inventory.

### Required remediation

Adopt a single agreement lifecycle claim discipline for all state-sensitive agreement mutations. Use conditional updates/version checks such as:

```text
UPDATE RentalAgreement
SET ...
WHERE id = ? AND status = ? AND version = ?
```

or an equivalent transactionally safe compare-and-set pattern.

Apply it to at least:

- add rental line;
- remove rental line;
- send for signature;
- sign;
- cancel;
- end;
- extend reservation;
- return-to-draft behavior if added;
- renewal / early termination / auto-renew changes.

### Acceptance evidence

Add real Postgres concurrency tests for at least:

1. add-line vs send-for-signature;
2. remove-line vs send-for-signature;
3. sign vs cancel;
4. sign vs end where applicable;
5. extend-reservation vs sign/cancel;
6. repeated identical requests remain idempotent.

The losing operation must fail cleanly without partially changing related inventory, signature, audit, or agreement rows.

---

## C2 — A created Stripe subscription is not persisted to the agreement

### Affected areas

- `src/domains/billing/checkout.ts`
- `src/domains/billing/webhooks.ts`
- `src/domains/billing/reminders.ts`
- `src/domains/agreements/index.ts`
- `tests/billing-start-recurring.test.ts`

### Problem

`startRecurringBillingForAgreement()` correctly checks `agreement.stripeSubscriptionId` as its durable idempotency guard, then creates a Stripe subscription, but ignores the returned subscription object. The following local update stamps `billingStartedAt` and clears a blocker without persisting `subscription.id` into `RentalAgreement.stripeSubscriptionId`.

This undermines multiple downstream behaviors:

- local idempotency no longer knows the agreement is subscribed;
- billing reminders require `stripeSubscriptionId`;
- recurring invoice webhooks resolve the agreement from Stripe's subscription ID;
- `customer.subscription.deleted` resolves from that ID;
- agreement closure cannot reliably identify the live subscription to cancel;
- provider reconciliation is harder because the local/provider link is missing.

Stripe's idempotency key protects a provider request within Stripe's idempotency window; it is not a substitute for durable local identity.

### Required remediation

Persist the returned subscription ID immediately after successful provider creation:

```text
stripeSubscriptionId = subscription.id
billingStartedAt = ...
billingBlockedReason = null
```

The implementation must also handle the external-success/local-write-failure window. At minimum:

- use deterministic Stripe metadata containing `agreementId`;
- make a retry/reconciliation path able to retrieve the already-created subscription by trusted metadata/idempotency outcome;
- make webhooks capable of repairing a missing local mapping when provider metadata safely identifies the agreement;
- never create a second live subscription merely because the local write failed.

### Acceptance evidence

Tests must prove:

1. successful subscription creation persists `stripeSubscriptionId`;
2. rerunning billing startup does not create a second subscription;
3. a provider-success/local-write-failure simulation can reconcile without duplicating billing;
4. invoice and subscription-deleted events can map to the correct agreement;
5. agreement closure cancels the correct provider subscription.

---

## C3 — Referral payout is not transactionally or externally idempotent

### Affected areas

- `src/domains/referrals/index.ts`
- `src/domains/billing/checkout.ts`
- `prisma/schema.prisma`
- `tests/referrals.test.ts`

### Problem

The current referral reward flow reads a PENDING referral, performs provider-side account-balance credits and local `CustomerCredit` inserts for both sides, and only afterward marks the referral REWARDED.

Two workers can both observe PENDING and both grant rewards.

Partial provider/database failure can also duplicate value. Example:

```text
Stripe credit succeeds for referrer
local CustomerCredit succeeds for referrer
second-side operation fails
Referral remains PENDING
retry runs whole flow
referrer can receive value again
```

The current `PENDING`/`REWARDED` state alone is not a sufficient payout ledger.

### Required remediation

Create durable per-recipient reward state rather than treating the referral row as the entire payout ledger.

A recommended shape is a `ReferralReward`/`ReferralPayout` row with a unique key such as:

```text
(referralId, recipientCustomerId)
```

Each side should have explicit provider/local application status and a deterministic provider idempotency identity.

A retry must resume from the last durable confirmed state, not replay already-confirmed grants.

Possible state model:

```text
PENDING
CLAIMED
REFERRER_APPLIED
REFERRED_APPLIED
REWARDED
```

A normalized per-side payout table is preferable because it naturally represents independently recoverable sides.

### Acceptance evidence

Use real database concurrency tests plus mocked provider idempotency tests proving:

- two simultaneous reward attempts produce one reward per side;
- failure after side A succeeds does not repay A on retry;
- provider timeout/ambiguous response cannot cause blind replay;
- local payout state remains reconcilable;
- final referral status becomes REWARDED only when both required sides are durably settled.

---

## C4 — Concurrent Stripe Customer creation can split one local customer across multiple Stripe customers

### Affected areas

- `src/domains/billing/checkout.ts`
- `Customer.stripeCustomerId`
- all signing/deposit checkout flows using `ensureStripeCustomer()`

### Problem

`ensureStripeCustomer()` follows a read-create-write sequence:

```text
read Customer
if stripeCustomerId exists -> return it
create Stripe customer
write stripeCustomerId
```

There is no atomic claim around a missing Stripe customer ID and no provider idempotency key tied to the local customer.

Two concurrent calls can therefore create two different Stripe Customers. One local write wins last, but an already-created Checkout Session may belong to the other Stripe Customer.

That can produce a particularly harmful split:

- signing Checkout saves a payment method under `cus_A`;
- local database eventually stores `cus_B`;
- delivery-time recurring billing tries to use a payment method owned by `cus_A` on `cus_B`.

### Required remediation

Use a deterministic Stripe idempotency key based on Appliance Desk `customerId` and add a database/provider reconciliation strategy so there is exactly one canonical Stripe Customer per local Customer.

If a duplicate provider object is ever discovered, the application must not silently switch between them.

### Acceptance evidence

A concurrency test must prove that simultaneous checkout setup calls for one Appliance Desk customer resolve to one canonical Stripe customer ID and that subsequent payment-method/subscription operations use the same provider customer.

---

# High findings

## H1 — Removing a rental line appears structurally impossible against the real database

### Affected areas

- `src/domains/agreements/index.ts::removeRentalLine`
- `prisma/schema.prisma`
- initial migration foreign key for `ApplianceAssignment.rentalLineId`

### Problem

Every normal rental line has `ApplianceAssignment` child rows. `removeRentalLine()` marks those rows unassigned, releases their appliances, then deletes the parent `RentalLine`.

However, the assignment rows remain and the foreign key from `ApplianceAssignment.rentalLineId` to `RentalLine.id` has no cascade or set-null behavior. PostgreSQL's default restrict/no-action behavior should reject deletion of the referenced rental line.

A mocked Prisma `delete()` test cannot reveal this database constraint failure.

### Required remediation

Preserve assignment history without violating referential integrity. Preferred options include:

1. soft-retire/remove the rental line rather than hard delete; or
2. retain a historical parent record and mark the line removed; or
3. if hard deletion is truly desired, intentionally migrate assignment history to a separate historical model before deletion.

Do not simply cascade-delete assignment history unless product requirements explicitly decide that losing assignment history is acceptable; current audit/history expectations suggest it is not.

### Acceptance evidence

A real Postgres integration test must create a draft line with assignments, remove it through the domain function, and prove:

- operation succeeds;
- appliances return to AVAILABLE;
- agreement no longer treats the line as active;
- historical assignment/audit facts remain queryable;
- no FK violation occurs.

---

## H2 — Fixed-term agreements can continue billing after their stated term ends

### Affected areas

- `RentalAgreement.termMonths`
- Stripe monthly subscriptions
- `src/domains/exceptions/rules.ts::agreementTermExpiredException`
- future B34/B35/B36 renewal/termination/auto-renew scope

### Problem

A six- or twelve-month contract currently starts a normal monthly Stripe subscription that has no automatic fixed-term stop behavior in the audited path.

The exception inbox warns that a term has expired but explicitly does not change the agreement or billing state. If the owner misses the exception, the subscription can continue charging indefinitely.

That effectively becomes accidental auto-renewal rather than an explicit renewal decision.

### Required remediation

Resolve this as part of the approved renewal/early-termination/auto-renew design:

- define end-of-term behavior explicitly;
- do not continue fixed-term billing merely because no one opened an exception;
- support explicit renewal and explicit auto-renew consent;
- retain signed policy/version evidence;
- coordinate provider subscription state with agreement lifecycle state;
- do not invent termination-fee amounts or renewal policy.

---

## H3 — Concurrent late-fee cron executions can apply the same fee twice

### Affected areas

- `src/domains/billing/late-fees.ts`

### Problem

`applyLateFees()` first selects invoices with `lateFeeCents = 0`, then later inserts a `LATE_FEE` line and updates the invoice.

Two overlapping workers can select the same candidate before either updates it. Both can create fee line items.

The invoice's `lateFeeCents` field is intended as the idempotency guard, but it is not claimed atomically.

### Required remediation

Claim the invoice atomically inside a transaction using a conditional update/version guard before inserting the fee line, or use an explicit uniquely keyed fee-application row.

### Acceptance evidence

A real concurrency test must run two late-fee workers against the same eligible invoice and prove one fee line, one audit, and one amount increase.

---

## H4 — Referral eligibility fires before successful payment is confirmed

### Affected areas

- `src/domains/billing/checkout.ts`
- `src/domains/referrals/index.ts`
- Stripe webhook flow

### Problem

Referral reward logic is invoked immediately after `stripe.subscriptions.create()` returns and local billing start is stamped.

That is not equivalent to confirmed successful collection of the first rent payment. Depending on Stripe subscription/payment behavior, creation can exist before the first invoice is durably known as paid.

The repository's stated referral policy is that reward should occur only when the referred customer actually starts paying.

### Required remediation

Trigger referral eligibility from the first confirmed successful rental payment/invoice event, using an idempotent durable reward claim.

Do not trigger on signup, agreement signing, delivery alone, or mere subscription object creation.

---

## H5 — Referral credit has two competing sources of truth

### Affected areas

- `src/domains/referrals/index.ts`
- `CustomerCredit`
- customer billing views/manual credit application

### Problem

When a Stripe account-balance credit succeeds, the code also creates a local `CustomerCredit` with the full amount represented as remaining.

The local model otherwise represents usable future credit. Without a structured field that distinguishes “already applied at Stripe” from “still locally available to apply,” the system/operator can treat the same value as available twice.

Human-readable notes are not a reliable financial state machine.

### Required remediation

Normalize credit state. At minimum distinguish:

- locally available/unapplied;
- reserved/being applied;
- applied through Stripe/provider;
- consumed against a specific invoice;
- reversed/voided if needed.

If Stripe's balance is the authoritative applied credit, the local ledger should mirror that fact without leaving `remainingCents` misleadingly available.

---

## H6 — Agreement closing can split Stripe state from local state

### Affected areas

- `src/domains/agreements/index.ts`
- Stripe subscription cancellation
- `customer.subscription.deleted` webhook

### Problem

Agreement close logic cancels the Stripe subscription before the local database transaction commits.

If the provider cancellation succeeds and the following local transaction fails, the agreement can remain ACTIVE locally while real recurring billing has stopped.

The subscription-deleted webhook intentionally does not change agreement status, so it does not automatically repair that split.

### Required remediation

Implement an explicit close/cancel state machine with durable intent and reconciliation, for example:

```text
ACTIVE
CLOSING / CANCELLATION_PENDING
provider cancellation requested/confirmed
local equipment/agreement closure finalized
ENDED/CANCELLED
```

Retries must be safe and provider deletion webhooks must reconcile an in-progress close without inventing the business decision to close an otherwise-active rental.

---

## H7 — Configured delivery, installation and removal fees are not standard agreement billing terms

### Affected areas

- `BusinessSettings.oneTimeDeliveryFeeCents`
- `BusinessSettings.oneTimeInstallationFeeCents`
- `BusinessSettings.oneTimeRemovalFeeCents`
- public pricing page
- agreement builder
- `buildCheckoutLinePlan()`
- invoice line-item kinds

### Problem

The owner can configure delivery, installation and pickup/removal fees and the public pricing page displays them. However, the standard agreement/billing plan does not snapshot or apply them as agreement charges.

`buildCheckoutLinePlan()` covers rental lines, deposit and damage waiver, but not these configured one-time fees.

This means settings can imply a charge is configured while normal contract/billing behavior does not actually carry it into the customer's agreement.

### Required remediation

Decide and implement the intended fee workflow without inventing policy:

- prefill configured defaults in the agreement builder;
- allow owner override where appropriate;
- snapshot the agreed amount on the agreement or explicit agreement charge rows;
- disclose the one-time fee before signature;
- charge/invoice it at the approved lifecycle moment;
- preserve immutable historical amount after commitment.

---

## H8 — New agreements do not inherit several configured business-policy defaults

### Affected areas

- `src/app/desk/agreements/new/page.tsx`
- `src/app/desk/agreements/new/rental-wizard.tsx`
- `BusinessSettings`
- agreement draft creation

### Problem

A fresh rental wizard initializes fields such as late fee and tax to blank/zero values and does not receive the current `BusinessSettings` values as starting defaults.

The repository describes BusinessSettings as the owner-editable home for pricing/policy defaults, yet creating a normal new agreement requires the operator to manually reproduce those settings correctly.

This increases the chance of inconsistent contracts and makes configured policies less meaningful.

### Required remediation

When starting a new draft, load the current approved owner-configured defaults for applicable terms. Once the draft is created, snapshot those values onto the agreement so subsequent global setting changes do not rewrite an existing deal.

Do not silently apply unconfirmed sales tax. Preserve the current `taxRateConfirmed` safety rule.

---

# Medium findings

## M1 — Concurrent published-price changes can corrupt price history

### Affected areas

- `src/domains/settings/index.ts::updateAppliancePrice`
- `PricingRule`
- pricing audit log

### Problem

The current appliance type and old price are read before the transaction that writes the new price and creates price-history/audit rows.

Two administrators updating the same item concurrently can both record the same old price even though one logically followed the other.

The final published price is last-writer-wins, but the historical old -> new chain can be false.

### Required remediation

Move the read/claim into the transaction and use version/CAS semantics so the recorded old value is the one that was actually replaced.

---

## M2 — The signing presentation does not disclose the frozen tax rate

### Affected areas

- `src/app/sign/[id]/page.tsx`
- `RentalAgreement.taxRatePermille`
- recurring billing tax application

### Problem

The signing page discloses monthly rental amount, discount, deposit, damage waiver and late-fee terms, but not the agreement's frozen sales-tax rate.

Recurring billing later applies that rate.

### Required remediation

Display the frozen agreement tax treatment/rate in the signing summary when applicable, including a clear zero/no-tax presentation when useful. Ensure the displayed value comes from the agreement snapshot, not current settings.

---

## M3 — Reservation extension is not atomic

### Affected areas

- `src/domains/agreements/index.ts::extendReservation`

### Problem

Reservation extension validates current state and then performs the update/audit without the same atomic lifecycle claim recommended in C1. It can race with signing/cancellation, and a split between the agreement update and audit can leave incomplete evidence.

### Required remediation

Bring extension under the same agreement lifecycle transaction/version discipline and make the update + audit atomic.

---

## M4 — Agreement pagination lacks a deterministic tie breaker

### Affected areas

- agreement list pagination/read ordering

### Problem

Ordering by `createdAt DESC` alone is unstable when two rows share the same timestamp. Offset pagination can then duplicate or skip rows as page boundaries move.

### Required remediation

Use a deterministic secondary key, e.g.:

```text
ORDER BY createdAt DESC, id DESC
```

and keep the same ordering across owner/staff variants.

---

## M5 — Stripe Product creation during recurring-billing startup is not idempotent

### Affected areas

- `src/domains/billing/checkout.ts::startRecurringBillingForAgreement`

### Problem

The recurring-billing startup creates a new Stripe Product for each rental line before creating the subscription.

If some products are created and a later provider call fails, a retry can create additional unused products even though the subscription creation itself uses an idempotency key.

### Required remediation

Use deterministic provider idempotency for product creation or persist/reuse provider product identities associated with the immutable agreement/rental-line snapshot.

---

# Verified strengths / non-findings

The following behaviors were specifically reviewed and should be preserved.

## Atomic appliance reservation

`addRentalLine()` uses conditional `AVAILABLE -> RESERVED` updates inside the same transaction that creates the line/assignment state. This is the right basic pattern for preventing two agreements from reserving the same physical unit.

## Concurrent draft creation protection

Draft creation uses a deterministic request key/draft identity, and the repository already contains real database-backed evidence that concurrent draft saves create one agreement and one audit rather than duplicate drafts.

## Immutable rental-line pricing snapshots

`RentalLine` retains:

- `listPriceCents`;
- `prepayDiscountCentsPerMonth`;
- `monthlyPriceCents`.

That correctly preserves the deal that was created rather than recomputing existing customer prices from current catalog settings.

## Duplicate-sign protection

The current signing implementation conditionally updates the `SignatureRecord` only while `signedAt` is null. This correctly blocks two overlapping submits of the same signing link. C1 does not invalidate this protection; it identifies the separate missing agreement-state claim.

## STAFF financial-data isolation

The operational STAFF DTOs avoid querying/returning pricing and other restricted finance fields, and E2E coverage checks response payloads for leaks. Preserve these restricted read models when changing agreement internals.

## Referral-code model

Referral codes are short, normalized consistently, and database-unique. `referredCustomerId` is unique, so a customer can have only one referrer. A referral code is not an authentication secret, so this audit does not classify `Math.random()` as a security defect in this context.

## Term-discount eligibility is intentional

The 6/12-month recurring discount is intentionally tied to the contract term, not the `paidInFullInAdvance` flag. The separate full-payment fact controls the 12-month free-month bonus. This repository decision is unusual enough to deserve verification, but it is not an audit defect.

---

# Relationship to already-approved B34–B36 scope

The approved business-logic audit already tracks:

- **B34:** customer renewal;
- **B35:** early cancellation with an approved/versioned early-termination fee system;
- **B36:** optional auto-renewal with explicit consent/opt-out/notices.

This Package 2 report does not duplicate those as three new findings merely to inflate the count.

However, H2 materially increases their importance. The end-of-term implementation must prevent a fixed-term subscription from becoming accidental auto-renewal merely because no one manually handled an exception.

Do not invent a termination-fee amount, auto-renew policy, notice period, or customer-consent language without the approved business rule.

---

# Recommended remediation packages

To avoid burning the full CI suite on many tiny PRs, resolve this audit in a small number of coherent implementation changes.

## Remediation Package A — Agreement integrity

Includes:

- C1 agreement lifecycle CAS/version discipline;
- H1 rental-line removal/history repair;
- M3 atomic reservation extension;
- M4 deterministic pagination;
- related lifecycle audit logging.

### Required tests

- real Postgres concurrency tests;
- real FK-backed rental-line removal test;
- sign-vs-cancel;
- send-vs-edit;
- extend-vs-sign/cancel;
- stable pagination test.

---

## Remediation Package B — Stripe lifecycle integrity

Includes:

- C2 durable subscription identity/reconciliation;
- C4 single canonical Stripe Customer;
- H2 fixed-term/provider lifecycle integration with B34–B36;
- H6 safe close/cancel reconciliation;
- M5 idempotent/reusable provider Product creation.

### Required tests

- provider success/local write failure;
- retry after ambiguous provider response;
- one canonical Stripe customer under concurrency;
- subscription mapping repaired from trusted metadata;
- safe close retry;
- fixed-term boundary scenarios.

Use Stripe test mode or provider mocks plus real database transaction tests; do not run live charges.

---

## Remediation Package C — Referral financial ledger

Includes:

- C3 per-side durable/idempotent payout ledger;
- H4 reward only on first confirmed successful payment;
- H5 one coherent representation of local vs provider-applied credit.

### Required tests

- simultaneous reward attempts;
- one-side success then failure;
- provider retry/timeout;
- second agreement for same referred customer does not repay referral;
- Stripe-applied credit is not later reusable as a fresh local credit;
- final payout state reconciles correctly.

---

## Remediation Package D — Pricing/policy integrity

Includes:

- H3 atomic late-fee claim;
- H7 standard one-time fee snapshot/application;
- H8 new-agreement defaults from BusinessSettings;
- M1 price-history CAS;
- M2 tax disclosure at signature.

### Required tests

- concurrent late-fee workers;
- settings-default -> new draft snapshot;
- changing settings does not rewrite existing draft/committed terms after the intended snapshot boundary;
- configured delivery/install/removal fee flows into agreement and invoice exactly once at the approved lifecycle moment;
- signing page displays frozen tax terms;
- concurrent price changes preserve a truthful old -> new chain.

---

# Priority order

Address in this order unless an implementation dependency requires a small reordering:

1. **C1** — agreement lifecycle contradiction/races;
2. **C2** — lost live Stripe subscription identity;
3. **C3** — duplicate/partially duplicated referral value;
4. **C4** — split Stripe customer identity;
5. **H1** — broken rental-line removal against real DB;
6. **H2–H8**;
7. **M1–M5**.

All Critical and High findings should be resolved before the agreements/pricing/referral subsystem is described as production-complete.

---

# Completion criteria for Package 2 remediation

Package 2 remediation is complete only when all of the following are true:

- all 17 findings are either fixed or explicitly dispositioned with a documented owner decision;
- no Critical/High item is marked resolved solely from a mock-based unit test where the defect depends on DB/provider behavior;
- agreement lifecycle transitions are race-safe under real Postgres concurrency;
- one local customer maps to one canonical Stripe customer;
- one active recurring agreement maps to one durable Stripe subscription identity;
- subscription create/close operations have an external-side-effect reconciliation strategy;
- referral rewards cannot be duplicated by concurrency, retry, timeout, or partial failure;
- configured owner policies actually flow into new agreement terms at the intended snapshot boundary;
- signed/customer-facing terms disclose the amounts/rules that can later be billed;
- physical inventory state, agreement state, billing state and referral-credit state remain mutually consistent after retries/failures;
- focused tests pass during implementation;
- one full repository CI run is green for each substantial remediation PR rather than for each tiny edit;
- documentation is updated to reflect the final behavior rather than merely the intended behavior.

---

# Files reviewed / traced

Primary evidence included, but was not limited to:

- `docs/AUDIT_ROADMAP.md`
- `docs/BUSINESS-RULES.md`
- `docs/DECISIONS.md`
- `docs/DATABASE.md`
- `docs/PRODUCT-SPEC.md`
- `src/domains/agreements/index.ts`
- `src/domains/agreements/draft-request.ts`
- `src/domains/agreements/reservation-status.ts`
- `src/domains/agreements/active-appliances.ts`
- `src/domains/agreements/progress.ts`
- `src/app/desk/agreements/actions.ts`
- `src/app/desk/agreements/new/page.tsx`
- `src/app/desk/agreements/new/rental-wizard.tsx`
- `src/app/sign/[id]/actions.ts`
- `src/app/sign/[id]/page.tsx`
- `src/domains/pricing/prepay-discount.ts`
- `src/domains/settings/index.ts`
- `src/domains/settings/form-schema.ts`
- `src/app/desk/settings/actions.ts`
- `src/app/desk/settings/settings-form.tsx`
- `src/domains/referrals/index.ts`
- `src/domains/referrals/code.ts`
- `src/domains/billing/checkout.ts`
- `src/domains/billing/webhooks.ts`
- `src/domains/billing/late-fees.ts`
- `src/domains/billing/reminders.ts`
- `src/domains/jobs/index.ts`
- `src/domains/exceptions/rules.ts`
- `src/domains/desk-access/index.ts`
- `prisma/schema.prisma`
- relevant migrations and agreement/billing/referral/E2E tests.

---

## Audit conclusion

Package 2 has good local safeguards in several individual functions, but the system-level consistency model is not yet strong enough across agreement state, provider billing state, and referral/credit state. The dominant remediation theme is to replace read-then-act workflows with durable conditional claims and recoverable state machines wherever a database transaction crosses an external provider boundary.

Once the Critical and High findings are fixed with real database/provider-boundary acceptance tests, the underlying architecture is capable of supporting the later renewal, early termination and auto-renew work without rebuilding the entire agreement subsystem.