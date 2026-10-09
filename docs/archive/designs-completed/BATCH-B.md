> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-09.
> Nothing in this file is a current instruction; any "current", "next", "approved" or
> "supersedes" language below is historical. The batch is built: its behavior is in the
> code and tests. The working documents are `AGENTS.md`, `docs/SESSION-START.md`,
> `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# Design — Batch B: Billing, provider reconciliation & financial ledger

Status: **APPROVED DESIGN — implement from this document.** Written 2026-10-02
by a heavy-reasoning model against the code as of `main` f272f51. The
decisions below are made; do not re-decide them. Where this document is
silent, stop and ask (see "Stop-and-ask points"). Scope and acceptance are in
`docs/PLAN.md` → Batch B; this document says *how*.

Read this design by section under the current `AGENTS.md` / `docs/PLAYBOOK.md`
anti-stall rules: list the headings first, then read only the decisions, assumptions,
work unit and tests needed for the current PR, in bounded chunks. Do not read the
audit reports end to end; each work unit names the finding it closes and quotes
what matters.

## 0. Verify these assumptions before starting (10 min)

Run each check. If any is false, stop and report — the design may need a
heavy-model revision before you continue.

| # | Assumption | How to check |
|---|---|---|
| A1 | `startRecurringBillingForAgreement` in `src/domains/billing/checkout.ts` still does **not** persist the subscription id it creates. | `grep -n "stripeSubscriptionId" src/domains/billing/checkout.ts` shows only reads, no `data: { stripeSubscriptionId` write. |
| A2 | `ensureStripeCustomer` is still read → create → write with no lock. | Read the function (≈ lines 89–111). |
| A3 | `rewardReferralIfEligible` in `src/domains/referrals/index.ts` still reads PENDING, grants both sides via `Promise.all`, then updates status. | Read the function. |
| A4 | `applyLateFees` in `src/domains/billing/late-fees.ts` still selects candidates outside a transaction and writes per invoice with `prisma.$transaction([...])` (array form, no row lock). | Read the function. |
| A5 | `closeAgreement` in `src/domains/agreements/index.ts` still calls `stripe.subscriptions.cancel` **before** the local transaction. | Read ≈ lines 543–570. |
| A6 | Webhooks are serialized by `pg_advisory_xact_lock(174831, 1)` in `processStripeWebhookEvent` and deduped by `WebhookEvent.id`. | Read the bottom of `src/domains/billing/webhooks.ts`. Keep both. |
| A7 | `Payment` rows are always attached to one `Invoice` (`invoiceId` required); manual payments create one `Payment` per invoice they touch and a `CustomerCredit` for any overpayment. | `src/domains/billing/manual-payments.ts` `recordManualPayment`. |
| A8 | `src/lib/business-date.ts` exports `businessDateKey`, `businessDayBounds`, `addBusinessDays`, `BUSINESS_TIME_ZONE`. | `grep -n "^export" src/lib/business-date.ts`. |
| A9 | Real-Postgres integration tests follow the pattern in `tests/webhook-atomicity-integration.test.ts` (skip unless `CI=true` and the DB is the local throwaway). | Open that file's first 20 lines. |

## 1. Decisions (made — do not re-open)

Each decision carries the reasoning so you can apply it to cases this
document did not foresee.

**D1. Every Stripe write goes through one local "provider operation" record,
created before the call, keyed by a deterministic idempotency key.**
Reason: Stripe's own idempotency key only protects the *request*; it does not
tell *us* afterwards what happened if our process died between the provider
succeeding and our database write. A local row that says "I intended to do
X with key K" lets a later run ask Stripe (by the same key, or by metadata)
and finish the job instead of doing it twice or never. This is the single
pattern that closes P2 C2, P2 C4, P2 H6, P2 M5 and P8 H2 together.

**D2. Lock-then-claim inside a transaction before any provider call; the
provider call happens *outside* the row lock; a second transaction records
the result.** Reason: holding a Postgres row lock across a network call
risks blowing the 30-second transaction budget and stalls every other writer
on that row. The claim row (D1) is what prevents double creation while the
lock is released. Sequence, always:

```
tx1: lock subject row FOR UPDATE → if already linked, return it
     → insert ProviderOperation(PENDING, key) (unique key; if it exists and
       is SUCCEEDED, use its providerObjectId and return; if PENDING and
       younger than 2 min, throw RetryLater; if PENDING and older, take it over)
provider call with { idempotencyKey: key }
tx2: lock subject row again → write providerObjectId if still unlinked
     (if linked to a *different* id meanwhile → keep the existing link,
      mark op DRIFT; never overwrite) → mark op SUCCEEDED
on provider error:   mark op FAILED with the message (sanitized)
on timeout/unknown:  mark op UNKNOWN (reconciliation will resolve it)
```

**D3. Local truth for credits is `CustomerCredit`; a Stripe balance credit is
the *delivery mechanism*, recorded as a provider operation on the credit.**
Reason: P2 H5 found two competing sources of truth. One has to win, and the
one we can query, lock and audit is ours. When a credit is pushed to Stripe
as a balance transaction, the local row records `appliedViaStripeAt` and its
`remainingCents` goes to 0 so it can never also be applied locally to an
invoice line. (Closes P2 H5, half of P2 C3.)

**D4. A referral is rewarded exactly once by a status claim on the Referral
row, and the trigger moves from "billing started" to "first invoice actually
paid".** Reason: P2 C3 (double grant) and P2 H4 (rewarding before any money
arrived). The claim is `PENDING → REWARDING` under `FOR UPDATE`; both
`CustomerCredit` rows are inserted in that same transaction with a unique
`(sourceType, sourceId, side)`; the Stripe pushes follow D1/D3; the final
`REWARDED` is set when both pushes are SUCCEEDED or the sides have no Stripe
customer yet (credit stays local, which is already today's documented
behavior).

**D5. Late fees: one fee per invoice, enforced by the database, and the cron
run is serialized.** Reason: P2 H3 / P8 H3 — two overlapping cron runs applied
the same fee twice and the invoice total only reflected one. A partial unique
index on `InvoiceLineItem (invoiceId) WHERE kind = 'LATE_FEE'` makes the second
insert impossible, the per-invoice work runs inside a transaction that locks
the invoice and re-checks `lateFeeCents = 0`, and the whole run takes
`pg_advisory_xact_lock(174831, 2)` so overlapping invocations queue instead of
interleave. (Namespace 174831 is already the billing lock namespace; 1 is
webhooks.)

**D6. Money movement gets a `Receipt` (one per real-world payment event)
with `Payment` rows as its allocations to invoices; overpayment becomes a
`CustomerCredit` whose source is that receipt.** Reason: RC3 / P5 H4 — a
check that covers three invoices is one event, and reports/exports need the
event, the allocations *and* the leftover to add up to the cash received.
`Payment` keeps its shape (one per invoice) so nothing that reads it today
breaks; it just gains a `receiptId`. Stripe-sourced payments get a receipt
too (keyed by charge id) so the export has one shape.

**D7. Credits are applied to invoices through `CreditApplication` rows, in a
transaction that locks the credit and the invoice.** Reason: "not double-
spendable" has to be a database fact, not a code hope. The `CREDIT` invoice
line item is created in the same transaction, and `remainingCents` is
decremented under lock. (RC3, B13.)

**D8. Local lifecycle first, provider second, reconciliation third — for
cancel/close.** Reason: P2 H6. Today the Stripe cancel happens before the
local transaction; if the local write then fails, Stripe is cancelled and we
still show ACTIVE. Reversed: the local transition and a `SUBSCRIPTION_CANCEL`
provider operation are committed together; then the cancel is attempted;
`customer.subscription.deleted` (already handled) and the reconciliation pass
confirm it. An agreement that is locally ENDED with a still-live subscription
is a visible drift row, never a silent one.

**D9. Fixed-term agreements carry their end into Stripe (`cancel_at`) and the
business calendar decides every billing date.** Reason: P2 H2 (billing past
term end) and P8 M3 / RC10 (server-clock dates). One helper computes billing
periods and due dates in America/Denver; Stripe is told the hard stop so even
a missed cron cannot bill month 13.

**D10. Renewal / early termination / auto-renew are built as domain
functions with policy *parameters*, and are switched off until the owner
supplies the policy.** Reason: B34–B36 require numbers only Chris can give
(fee formula, notice days, refund treatment). The mechanism is testable with
any parameters; the behavior is not exposed in UI until the policy exists
(UI is Batch D). A null policy means "feature not available", never a
default fee.

**D11. The drift workbench is read-only in this batch.** Reason: B18. Repair
with a UI means a human decides; we ship detection and the evidence first,
and the only automatic actions are finishing *our own* PENDING/UNKNOWN
operations by asking Stripe (which is completing an intent we recorded, not
guessing).

**D12. (Amended 2026-10-03, owner decision IN-17.) Tax is stored exactly as
thousandths of one percent (`taxRateMilliPercent`: 7375 = 7.375%); rounding is
half-up per line, then summed; never recomputed from totals.** The owner's
real rate is 7.375%, which tenths-of-a-percent cannot hold, so the original
"stay on `taxRatePermille`" decision was replaced. The old `taxRatePermille`
column stays (additive migration, never dropped here) and a database trigger
keeps it in step with the new column during deploys and rollbacks
(`20261003190000_tax_rate_columns_stay_in_step`); a later cleanup batch removes
both. All code reads and writes `taxRateMilliPercent` only, through the helpers
in `src/domains/billing/tax.ts` (`parseTaxRatePercent`, `formatTaxRate`,
`taxCentsForLine`). Reasons are in `docs/DECISIONS.md` (2026-10-03, tax storage).

**D13. (Added 2026-10-03.) A card payment that arrives for an invoice already
written off or voided is held, not credited.** Found by the race tests. The
webhook locks the customer then the invoice; if the invoice is closed it records
a receipt plus a payment row with status `held` (no schema change), creates no
`CustomerCredit`, does not reopen the invoice, writes the audit entry
`billing.payment_on_closed_invoice`, and shows the item as `HELD_PAYMENT` in the
drift workbench. A later Stripe refund of the charge finds it through the stored
payment-intent id. What to do with held money (credit it, reverse the write-off,
or refund it) is owner input IN-23; the screen that does it is not built until
Chris answers.

## 2. Schema changes (additive only)

Add to `prisma/schema.prisma` exactly as written; generate one migration
`20261003000000_batch_b_ledger` (adjust timestamp) and run
`node scripts/check-migrations.mjs`. Add every new table to
`src/lib/schema-health.ts`'s expected-table list and to the backup export
(`src/domains/backup`) in the same commit (WU-B1).

```prisma
// ---------------------------------------------------------------------------
// Batch B — provider operations (docs/designs/BATCH-B.md D1/D2)
// ---------------------------------------------------------------------------

enum ProviderOperationKind {
  CUSTOMER_CREATE
  SUBSCRIPTION_CREATE
  SUBSCRIPTION_CANCEL
  BALANCE_CREDIT
  REFUND_CREATE
}

enum ProviderOperationStatus {
  PENDING
  SUCCEEDED
  FAILED
  UNKNOWN   // call was sent, result never recorded (timeout/crash) — reconcile
  DRIFT     // provider succeeded but local subject was already linked elsewhere
}

model ProviderOperation {
  id             String                  @id @default(cuid())
  kind           ProviderOperationKind
  // What this operation is for: "Customer" + id, "RentalAgreement" + id,
  // "CustomerCredit" + id, "Refund" + id. Not a relation on purpose — one
  // table serves every subject.
  subjectType    String
  subjectId      String
  // Deterministic; also passed to Stripe as the request idempotency key.
  // Format: "<kind-slug>-<subjectId>[-<qualifier>]", e.g.
  // "customer-create-ckx...", "referral-credit-ckx...-referrer".
  idempotencyKey String                  @unique
  status         ProviderOperationStatus @default(PENDING)
  providerObjectId String?               // cus_…, sub_…, cbtxn_…, re_…
  attempts       Int                     @default(0)
  lastError      String?                 // sanitized message, never a key or PAN
  requestedAt    DateTime                @default(now())
  completedAt    DateTime?
  updatedAt      DateTime                @updatedAt

  @@index([subjectType, subjectId])
  @@index([status, requestedAt])
}

// ---------------------------------------------------------------------------
// Batch B — receipts, allocations, credit applications (D6/D7)
// ---------------------------------------------------------------------------

enum ReceiptSource {
  STRIPE
  MANUAL
}

model Receipt {
  id             String        @id @default(cuid())
  customerId     String
  customer       Customer      @relation(fields: [customerId], references: [id])
  source         ReceiptSource
  amountCents    Int           // gross cash received in this event
  method         String        // card | ach | check | cash | bank_transfer | other
  // Stripe charge id for STRIPE receipts; unique so a replayed webhook
  // cannot make a second receipt for the same money.
  stripeChargeId String?       @unique
  // Business-calendar date the money was received (D9); for Stripe the
  // charge's created time, for manual what the owner entered.
  receivedOn     DateTime
  recordedByUserId String?     // manual receipts only
  notes          String?
  payments       Payment[]
  createdAt      DateTime      @default(now())

  @@index([customerId, receivedOn])
}

model CreditApplication {
  id          String         @id @default(cuid())
  creditId    String
  credit      CustomerCredit @relation(fields: [creditId], references: [id])
  invoiceId   String
  invoice     Invoice        @relation(fields: [invoiceId], references: [id])
  amountCents Int
  appliedByUserId String?
  createdAt   DateTime       @default(now())

  @@index([creditId])
  @@index([invoiceId])
}
```

Field additions to existing models (keep every existing field):

```prisma
model Payment {
  // + Batch B (D6): the real-world payment event this allocation belongs to.
  //   Nullable only for rows that pre-date Batch B; WU-B5's backfill sets it
  //   for every existing row, after which application code treats null as a
  //   data error surfaced on the drift workbench.
  receiptId String?
  receipt   Receipt? @relation(fields: [receiptId], references: [id])
  @@index([receiptId])
}

model CustomerCredit {
  // + Batch B (D3/D4/D7): where this credit came from, unique per source so
  //   the same event can never mint two credits.
  //   sourceType: "REFERRAL" | "RECEIPT_OVERPAYMENT" | "MANUAL" | "REFUND_TO_CREDIT"
  //   side (REFERRAL only): "referrer" | "referred"
  sourceType String?
  sourceId   String?
  side       String?
  appliedViaStripeAt DateTime?   // pushed to Stripe balance; remainingCents is 0 from then on
  applications CreditApplication[]
  @@unique([sourceType, sourceId, side])
}

enum ReferralStatus {
  PENDING
  REWARDING   // + Batch B (D4): claimed; credits exist; provider pushes may be in flight
  REWARDED
}

model Invoice {
  // + Batch B: lets the drift workbench and write-off race test reason about
  //   the last state change without parsing audit logs.
  version Int @default(1)
  creditApplications CreditApplication[]
}

model RentalAgreement {
  // + Batch B (D9/D10). All nullable; null = feature not configured.
  renewalPreference       String?   // "NONE" | "AUTO_RENEW"; null = never asked
  autoRenewConsentedAt    DateTime?
  autoRenewTermsVersion   String?   // which policy text the customer consented to
  renewedFromAgreementId  String?   // set on the new agreement created by a renewal
  terminationRequestedAt  DateTime?
  terminationEffectiveOn  DateTime?
  terminationFeeCents     Int?      // snapshot at quote acceptance, never recomputed
  terminationPolicyVersion String?
}

model BusinessSettings {
  // + Batch B (D10): owner policy. ALL nullable; null means "policy not set —
  //   the related customer action is unavailable". Never default a fee.
  earlyTerminationFeeCents        Int?
  earlyTerminationFeePercent      Int?     // of remaining term rent, 0–100
  earlyTerminationFeeCapCents     Int?
  earlyTerminationNoticeDays      Int?
  unusedTermTreatment             String?  // "REFUND" | "CREDIT" | "RETAIN"
  autoRenewNoticeDays             Int?
  autoRenewTermsVersion           String?
  renewalTermsText                String?
  terminationTermsText            String?
}
```

Partial unique index (Prisma cannot express it — add raw SQL to the same
migration file, after the generated statements):

```sql
-- One late fee per invoice, enforced by the database (D5).
CREATE UNIQUE INDEX "InvoiceLineItem_one_late_fee_per_invoice"
  ON "InvoiceLineItem" ("invoiceId") WHERE "kind" = 'LATE_FEE';
```

`scripts/test-migration-upgrade.ts` must keep passing: the populated-upgrade
drill must show existing invoices with at most one LATE_FEE line (if the
drill fixture has two, that fixture is wrong — fix the fixture, note it).

## 3. Shared primitive: `src/domains/billing/provider-ops.ts` (WU-B2)

One module every Stripe write uses. Signatures are fixed:

```ts
import type { Prisma } from "@prisma/client";

export type ProviderOpKind = "CUSTOMER_CREATE" | "SUBSCRIPTION_CREATE" | "SUBSCRIPTION_CANCEL" | "BALANCE_CREDIT" | "REFUND_CREATE";

export class RetryLater extends Error {}   // another worker owns the operation; caller retries or reports

/** tx1 of D2. Returns the existing providerObjectId if the op already
 *  SUCCEEDED, or the claimed op row to proceed with. Throws RetryLater if
 *  another worker holds a PENDING claim younger than `staleAfterMs`. */
export async function claimProviderOperation(tx: Prisma.TransactionClient, input: {
  kind: ProviderOpKind; subjectType: string; subjectId: string; idempotencyKey: string;
  staleAfterMs?: number; // default 120_000
}): Promise<{ done: true; providerObjectId: string } | { done: false; opId: string; idempotencyKey: string }>;

/** tx2 of D2. */
export async function completeProviderOperation(tx: Prisma.TransactionClient, opId: string, result:
  | { status: "SUCCEEDED"; providerObjectId: string }
  | { status: "FAILED"; error: unknown }
  | { status: "UNKNOWN"; error?: unknown }
  | { status: "DRIFT"; providerObjectId: string; note: string }): Promise<void>;

/** Wraps a Stripe call: maps StripeConnectionError / timeout → "UNKNOWN",
 *  StripeInvalidRequestError and card errors → "FAILED", success → the object. */
export async function runProviderCall<T>(call: () => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; outcome: "FAILED" | "UNKNOWN"; error: unknown }>;

/** Sanitize for lastError: Stripe message only; strip anything matching
 *  /sk_(live|test)|pk_|[0-9]{13,19}/. Max 500 chars. */
export function sanitizeProviderError(error: unknown): string;
```

Rules: never call `getStripeClient()` from inside a `prisma.$transaction`
callback. Never `console.log` a Stripe object; log `op.id` and the kind.

Tests (`tests/billing-provider-ops.test.ts`, unit with fake tx; and
`tests/billing-provider-ops-integration.test.ts`, real Postgres):
1. claim on a fresh key → `{done:false}`; same key again while PENDING → `RetryLater`.
2. claim after SUCCEEDED → `{done:true, providerObjectId}`.
3. claim after PENDING older than stale → takes over (attempts+1).
4. `runProviderCall` maps a thrown `Stripe.errors.StripeConnectionError` to UNKNOWN and `StripeInvalidRequestError` to FAILED.
5. (integration) 10 concurrent claims on one key → exactly one `{done:false}`, nine `RetryLater`.
6. `sanitizeProviderError` strips a fake `sk_test_abc` and a 16-digit number.

## 4. Work units (do them in this order; one commit each)

Each unit: **Closes** (finding IDs) · **Files** · **Change** · **Tests**
(file + named cases) · **Done when**.

### WU-B1 — Schema, migration, health, backup
Closes: foundation for everything below.
Files: `prisma/schema.prisma`, `prisma/migrations/<ts>_batch_b_ledger/migration.sql`, `src/lib/schema-health.ts`, `src/domains/backup/*` (wherever the table list lives — grep `WebhookEvent` to find it), `docs/DATABASE.md`.
Change: Section 2 verbatim, plus the raw partial index. Document each table in `docs/DATABASE.md` with two lines: what it is, which decision (D-number) it serves.
Tests: `npm run check:migrations` passes; `npx tsx scripts/test-schema-health.ts` still rejects a missing column; existing `tests/backup-*.test.ts` updated so the new tables are in the export.
Done when: typecheck + lint clean; migration drill (`scripts/test-migration-upgrade.ts`) passes locally if runnable, else noted for CI.

### WU-B2 — `provider-ops.ts`
As Section 3. Done when its tests pass.

### WU-B3 — `ensureStripeCustomer` under D2
Closes: P2 C4, P8 H2.
Files: `src/domains/billing/checkout.ts`, `tests/billing-ensure-stripe-customer.test.ts` (new), `tests/billing-ensure-stripe-customer-integration.test.ts` (new).
Change: rewrite `ensureStripeCustomer(customerId)`:
```
tx1: SELECT id, "stripeCustomerId" FROM "Customer" WHERE id=$1 FOR UPDATE
     if stripeCustomerId → return it
     claim = claimProviderOperation(tx, {kind:"CUSTOMER_CREATE", subjectType:"Customer", subjectId, idempotencyKey:`customer-create-${customerId}`})
     if claim.done → write stripeCustomerId=claim.providerObjectId (still inside tx1) → return
call: stripe.customers.create({...same fields as today, metadata:{customerId}}, {idempotencyKey})
tx2: lock Customer again; if stripeCustomerId null → set it, complete SUCCEEDED
     else if equal → complete SUCCEEDED; else → complete DRIFT (note both ids), return the existing one
on FAILED/UNKNOWN: complete accordingly, rethrow a plain Error("Couldn't set up billing for this customer — try again in a minute.")
```
Tests (unit): returns existing id without any Stripe call; creates once; second call after success returns without Stripe; connection error → op UNKNOWN and error thrown. (integration) 5 concurrent `ensureStripeCustomer` on one customer with a fake Stripe that counts `customers.create` calls → exactly 1 call, all 5 return the same id (4 may throw RetryLater — assert the *count of distinct ids* is 1 and Customer.stripeCustomerId is set).
Done when: all pass; `grep -rn "customers.create" src/` shows only this call site.

### WU-B4 — Subscription identity persisted; metadata fallback; fixed-term `cancel_at`
Closes: P2 C2, P2 M5, P2 H2 (provider side).
Files: `src/domains/billing/checkout.ts` (`startRecurringBillingForAgreement`), `src/domains/billing/webhooks.ts` (`handleInvoicePaid`, `handleInvoicePaymentFailed`, `handleSubscriptionDeleted`), `src/domains/billing/reminders.ts` (read only — verify it keys on `stripeSubscriptionId`), `tests/billing-start-recurring.test.ts` (extend), `tests/billing-webhooks.test.ts` (extend).
Change:
1. In `startRecurringBillingForAgreement`, replace the create block with D2: claim `subscription-create-${agreementId}` (subject RentalAgreement); products: create each with `idempotencyKey: \`product-${rentalLineId}\`` (closes M5); `subscriptions.create` with the existing key and additionally `cancel_at: <unix seconds of agreement.endDate at 23:59:59 America/Denver>` when `termMonths` and `endDate` are set (D9); tx2 writes `stripeSubscriptionId: sub.id`, `billingStartedAt`, clears blocker, completes op. Remove the `rewardReferralIfEligible` call here (moves to WU-B6).
2. Add `async function resolveAgreementForSubscription(db, subscriptionId): Promise<{id, customerId} | null>` in webhooks.ts: find by `stripeSubscriptionId`; if null, `stripe.subscriptions.retrieve(subscriptionId)` → `metadata.agreementId` → if that agreement exists and its `stripeSubscriptionId` is null, **heal** it (write the id, audit `billing.subscription_id_healed`) and return it. Use it in the three handlers.
Tests: subscription id persisted on success; `cancel_at` present for a 12-month term and absent month-to-month; invoice.paid for an agreement whose id was never persisted resolves via metadata and heals; provider UNKNOWN leaves `billingBlockedReason` set and op UNKNOWN; no referral call from this path anymore.
Done when: `grep -n "rewardReferralIfEligible" src/domains/billing/checkout.ts` returns nothing.

### WU-B5 — Receipts and allocations
Closes: RC3 core, P5 H4, P5 H5 (date basis), P8 C1 regression guard.
Files: `src/domains/billing/manual-payments.ts`, `src/domains/billing/webhooks.ts` (`recordPaidInvoice`, `recordOneTimeSigningCharge`, `recordEstimateDepositPayment` — every place a `Payment` is created), `src/domains/billing/ledger.ts` (new), `prisma/seed.ts` only if fixtures need a receipt, `scripts/backfill-receipts.ts` (new, idempotent), `tests/billing-ledger.test.ts` (new), `tests/billing-manual-payments.test.ts` (extend), `tests/billing-receipts-integration.test.ts` (new).
Change:
1. `ledger.ts` exports:
```ts
export async function createReceiptWithAllocations(tx, input: {
  customerId: string; source: "STRIPE"|"MANUAL"; amountCents: number; method: string;
  receivedOn: Date; stripeChargeId?: string; recordedByUserId?: string; notes?: string;
  allocations: Array<{ invoiceId: string; amountCents: number }>;   // sum ≤ amountCents
}): Promise<{ receiptId: string; overpaymentCreditId: string | null }>;
```
   It locks the customer (`lockCustomerLedger`, already in manual-payments — move it to ledger.ts and export), locks each invoice `FOR UPDATE` in id order (deadlock-safe), creates the Receipt, one `Payment` per allocation with `receiptId`, updates each invoice's `amountPaidCents`/`status` exactly as `recordManualPayment` does today, and creates a `CustomerCredit{sourceType:"RECEIPT_OVERPAYMENT", sourceId: receiptId}` for the remainder (unique → cannot double-mint).
2. `recordManualPayment` becomes a thin caller: compute allocations (same spreading rule as today), call `createReceiptWithAllocations`.
3. Webhook payment writers: create the receipt with `stripeChargeId` (unique) — a replayed event that already has a receipt for that charge is a no-op for the receipt (find first).
4. `scripts/backfill-receipts.ts`: for each `Payment` with `receiptId null`, create one Receipt per (`stripeChargeId` if set, else per Payment) and link; idempotent; refuses to run unless `--confirm` and prints counts. Runs in CI against the drill DB (add to `scripts/test-migration-upgrade.ts` after migrations) and once by Chris on production (OWNER-INPUTS IN-18, "run backfill" — see Section 6).
Tests: three open invoices + a $250 check → 3 payments, 1 receipt, amounts add up, no credit; $400 → credit for the leftover with unique source; same receipt input twice (same `stripeChargeId`) → 1 receipt; (integration) two concurrent manual payments on one customer → payments sum equals both amounts and no invoice overpaid (extends the Batch A test).
Done when: every `tx.payment.create` in `src/` goes through `ledger.ts` (grep).

### WU-B6 — Referral reward claim (D4) + credit source uniqueness (D3)
Closes: P2 C3, P2 H4, P2 H5.
Files: `src/domains/referrals/index.ts`, `src/domains/billing/webhooks.ts` (`handleInvoicePaid` → after a PAID write, call `rewardReferralOnFirstPaidInvoice(db, customerId)`), `tests/referrals.test.ts` (rewrite the reward cases), `tests/referrals-integration.test.ts` (new).
Change:
```ts
/** Called inside the webhook transaction after an invoice becomes PAID.
 *  Claims the referral and mints both local credits atomically; returns
 *  the credit ids so the caller can schedule provider pushes AFTER commit. */
export async function rewardReferralOnFirstPaidInvoice(tx, referredCustomerId): Promise<{ creditIds: string[] } | null>;
/** After commit (not in the webhook tx): pushes each credit to Stripe as a
 *  balance transaction via provider-ops (kind BALANCE_CREDIT, key
 *  `referral-credit-${referralId}-${side}`), sets appliedViaStripeAt and
 *  remainingCents=0 on success; leaves the local credit usable on FAILED;
 *  marks the referral REWARDED when both sides are settled. */
export async function settleReferralCredits(referralId: string): Promise<void>;
```
`handleInvoicePaid` only calls the first; the webhook route calls `settleReferralCredits` after `processStripeWebhookEvent` resolves (fire-and-forget with error logging is acceptable because the reconciliation pass (WU-B9) retries PENDING/FAILED pushes).
Tests: PENDING → one call mints exactly 2 credits with `(REFERRAL, referralId, side)`; a second invoice.paid does nothing; (integration) two concurrent claims → one wins; settle with Stripe success → `appliedViaStripeAt` set, `remainingCents` 0, status REWARDED; settle with Stripe FAILED → credit stays local with remaining = reward, status stays REWARDING, op FAILED; a credit with `appliedViaStripeAt` cannot be applied by WU-B7.
Done when: `rewardReferralIfEligible` is deleted (grep returns nothing).

### WU-B7 — Credit application (D7) and write-off race (P8 H1)
Closes: P8 H1, B13 (domain part).
Files: `src/domains/billing/ledger.ts` (add), `src/domains/billing/manual-payments.ts` (`writeOffInvoice`), `tests/billing-ledger.test.ts`, `tests/billing-writeoff-race-integration.test.ts` (new).
Change:
```ts
export async function applyCreditToInvoice(tx, input: { creditId: string; invoiceId: string; amountCents: number; appliedByUserId: string }): Promise<void>;
// locks credit then invoice (FOR UPDATE, in that order everywhere); rejects if
// credit.appliedViaStripeAt set, remaining < amount, invoice not OPEN/PARTIALLY_PAID/DELINQUENT,
// or amount > outstanding; creates CreditApplication + InvoiceLineItem{kind:CREDIT, amount:-x};
// decrements remainingCents; updates invoice amountPaid/status; invoice.version += 1.
```
`writeOffInvoice`: inside its transaction, lock the invoice `FOR UPDATE` first, then re-read status and `amountPaidCents`; refuse if status is PAID or `amountPaidCents >= amountDueCents`; bump `version`.
Tests: apply more than remaining → rejected; apply to PAID invoice → rejected; Stripe-applied credit → rejected; happy path balances; (integration) concurrent write-off vs manual payment that completes the invoice → exactly one succeeds and the invoice ends PAID, never WRITTEN_OFF.

### WU-B7b — Refund decisions at the domain level (D1 for `REFUND_CREATE`)
Closes: B06, B13 (domain part); UI is Batch D (WU-D5).
Files: `src/domains/billing/refunds.ts` (new), `tests/billing-refunds.test.ts`, `tests/billing-refunds-integration.test.ts`.
```ts
export async function decideDepositRefund(userId, input: { depositId: string; refundCents: number; deductionReason?: string; disputeNotes?: string; expectedVersion?: number }): Promise<{ providerOpId: string | null }>;
// OWNER/ADMIN only (assertActiveTeamActor + role check); tx1: lock Deposit FOR UPDATE; reject if already refunded or refundCents > amountCents or (refundCents < amountCents && !deductionReason);
// write refundedAt/refundedAmountCents/deductionReason/refundedByUserId; audit "deposit.refund_decided"; if the deposit was collected through Stripe (find the Receipt by the deposit's invoice line), claim REFUND_CREATE key `deposit-refund-${depositId}`;
// after commit: stripe.refunds.create({ charge, amount, metadata:{ depositId } }, { idempotencyKey }); tx2 completes the op and writes Deposit.stripeRefundId. Manual (cash/check) deposits: no provider op; the owner records how it was returned in notes.
export async function issueInvoiceRefund(userId, input: { invoiceId: string; amountCents: number; reason: RefundReason; notes?: string; toCredit?: boolean }): Promise<{ refundId: string; providerOpId: string | null }>;
// tx1: lock invoice + customer ledger; reject if amount > amountPaidCents − already refunded; create Refund row; if toCredit → CustomerCredit{sourceType:"REFUND_TO_CREDIT", sourceId: refundId} instead of a provider refund; else claim REFUND_CREATE key `invoice-refund-${refundId}` and call stripe.refunds.create after commit against the Receipt's stripeChargeId; manual receipts → no provider op (owner returns money by hand; recorded).
```
Tests: partial deposit refund without reason rejected; over-refund rejected; second decision rejected; Stripe UNKNOWN leaves op UNKNOWN and the local decision intact; `toCredit` mints exactly one credit; STAFF rejected.

### WU-B8 — Late fees (D5)
Closes: P2 H3, P8 H3, B12.
Files: `src/domains/billing/late-fees.ts`, `src/app/api/cron/late-fees/route.ts` (unchanged unless it needs to surface "skipped: another run active"), `tests/billing-late-fees.test.ts` (extend), `tests/billing-late-fees-integration.test.ts` (new).
Change: `applyLateFees` → `prisma.$transaction(async tx => { await tx.$queryRaw\`SELECT pg_advisory_xact_lock(174831, 2)\`; ...candidates via tx...; for each: lock invoice FOR UPDATE, re-check status/lateFeeCents=0/outstanding, insert line + update + audit })`, 30 s timeout like webhooks; if the candidate set could exceed ~500, process in batches of 100 per transaction (each batch takes the advisory lock). Grace-day arithmetic uses `addBusinessDays`? **No** — grace days are calendar days per BUSINESS-RULES; but "today" must be the business date: compare `businessDateKey(now)` with `businessDateKey(dueDate + graceDays)` (D9).
Tests: unit cases as today plus "already has lateFeeCents → skipped"; (integration) two concurrent `applyLateFees()` → one LATE_FEE line per invoice and `amountDueCents` incremented once; direct second insert of a LATE_FEE line throws the unique violation.

### WU-B9 — Close/cancel reconciliation (D8) + reconciliation pass + drift detection (D11)
Closes: P2 H6, B18, B31 (recovery part).
Files: `src/domains/agreements/index.ts` (`closeAgreement`), `src/domains/billing/reconciliation.ts` (new), `src/app/api/cron/billing-reconcile/route.ts` (new, same CRON_SECRET pattern as late-fees), `vercel.json` (add the cron, daily), `src/app/desk/billing/reconciliation/page.tsx` (new, OWNER/ADMIN, read-only table), `tests/agreements-close-stripe-subscription.test.ts` (rewrite), `tests/billing-reconciliation.test.ts` (new).
Change:
1. `closeAgreement`: move the Stripe cancel *after* the local transaction; inside the transaction, when `stripeSubscriptionId` is set, claim `SUBSCRIPTION_CANCEL` with key `subscription-cancel-${agreementId}`; after commit, `runProviderCall(() => stripe.subscriptions.cancel(id))`; `resource_missing` counts as SUCCEEDED; complete the op in tx2. Never throw to the caller for a provider failure — the agreement is closed locally and the op is visible.
2. `reconciliation.ts`:
```ts
export type DriftRow = { kind: "PENDING_OP"|"UNKNOWN_OP"|"FAILED_OP"|"SUB_LIVE_BUT_LOCAL_CLOSED"|"LOCAL_ACTIVE_NO_SUB"|"STRIPE_CUSTOMER_MISSING"|"INVOICE_STATUS_MISMATCH"|"PAYMENT_WITHOUT_RECEIPT"; subjectType: string; subjectId: string; detail: string; since: Date };
export async function finishPendingProviderOperations(limit = 50): Promise<{ completed: number; stillUnknown: number }>;
// for each PENDING older than 2 min or UNKNOWN: by kind, ask Stripe —
//   CUSTOMER_CREATE: customers.search({query:`metadata['customerId']:'${id}'`}) → if found, complete as SUCCEEDED + link if unlinked
//   SUBSCRIPTION_CREATE: subscriptions.search by metadata agreementId → same
//   SUBSCRIPTION_CANCEL: subscriptions.retrieve → status canceled ⇒ SUCCEEDED, else re-attempt cancel once
//   BALANCE_CREDIT: customers.listBalanceTransactions, match metadata.creditId ⇒ SUCCEEDED
//   REFUND_CREATE: refunds.list by metadata ⇒ SUCCEEDED
export async function detectDrift(limit = 200): Promise<DriftRow[]>;   // read-only; bounded; no writes
```
3. Cron route: `finishPendingProviderOperations()` then nothing else (detection is on-demand from the page).
4. Page: table of `detectDrift()` rows with plain-English `detail`, a "Last checked" time, and *no* action buttons. Link it from the billing nav for OWNER/ADMIN only.
Tests: close with Stripe UNKNOWN → agreement ENDED locally, op UNKNOWN; reconcile with Stripe reporting canceled → op SUCCEEDED; `detectDrift` on seeded mismatches returns the expected kinds and performs zero writes (assert with a Prisma `$use`/spy that no create/update ran); page renders for OWNER, 403 for STAFF (unit on the loader).

### WU-B10 — Fixed-term boundary, renewal, early termination, auto-renew (D9/D10)
Closes: P2 H2 (local), B34, B35, B36, B28 (mechanism), B22 (tests).
Files: `src/domains/agreements/term.ts` (new), `src/lib/business-date.ts` (add `billingPeriodFor(anchor: Date, monthsAhead: number): { start: Date; end: Date }` and `businessEndOfDay(date): Date`), `src/domains/billing/tax.ts` (new: `taxCentsForLine(amountCents, taxRateMilliPercent)` half-up (amended 2026-10-03: see D12); `sumTax(lines)`), `src/domains/settings` (expose the new policy fields; **no UI** — Batch D), `tests/agreements-term.test.ts`, `tests/billing-tax.test.ts`, `tests/business-date.test.ts` (extend with DST cases 2026-03-08 and 2026-11-01).
Change (all pure or transactional, no UI):
```ts
export type TerminationPolicy = { feeCents: number|null; feePercent: number|null; feeCapCents: number|null; noticeDays: number; unusedTerm: "REFUND"|"CREDIT"|"RETAIN"; version: string };
export function loadTerminationPolicy(settings): TerminationPolicy | null;   // null if any required field null
export function quoteEarlyTermination(agreement, policy, requestedOn: Date): { effectiveOn: Date; remainingTermMonths: number; remainingRentCents: number; feeCents: number; unusedTermCents: number; unusedTermTreatment: ...; unpaidBalanceCents: number; policyVersion: string };
export async function requestEarlyTermination(userId, agreementId, quote): Promise<void>;  // locks agreement, re-quotes, rejects if quote changed, writes termination* fields + audit; does NOT end the agreement (ending happens at effectiveOn via existing close path + job)
export async function renewAgreement(userId, agreementId, input: { termMonths: number|null; startOn: Date }): Promise<{ newAgreementId: string }>; // creates a new DRAFT agreement copying lines/prices, sets renewedFromAgreementId, leaves old one untouched until its endDate; no Stripe call here
export async function setAutoRenew(userId, agreementId, input: { enabled: boolean; termsVersion: string }): Promise<void>; // consent fields + ConsentRecord kind "auto_renew"; disabling never cancels
```
Fee formula (apply exactly): `fee = min(cap ?? ∞, max(feeCents ?? 0, round(remainingRentCents * feePercent/100)))`; `remainingRentCents` = monthly total × whole months between `effectiveOn` and `endDate` using `billingPeriodFor`; `effectiveOn` = later of (requestedOn + noticeDays, next billing date). Never prorate within a month (BUSINESS-RULES: anniversary billing, no proration).
Tests: policy null → `loadTerminationPolicy` null and `requestEarlyTermination` throws "not available"; fee cases: flat only, percent only, both (max), cap; notice pushes `effectiveOn` to the next anniversary; renewal creates a DRAFT linked copy and old agreement unchanged; auto-renew disable leaves status ACTIVE; tax: 7.3% on 6000¢ = 438¢, on 1¢ = 0¢, three lines rounded individually sum ≠ naive total (assert the documented behavior); DST: a billing anchor on Mar 8 and Nov 1 keeps the same wall-clock day.

### WU-B11 — Reports and statements consume the ledger
Closes: P5 H1, H2, H4, H5, P5 M4, part of B09.
Files: `src/domains/billing/revenue.ts`, `revenue-records.ts`, `statements.ts`, `src/domains/reports/*` (grep "amountPaidCents" and "Payment" to find the readers), `src/lib/csv.ts` (export columns), `tests/billing-statements.test.ts`, `tests/reports-*.test.ts`.
Change: add `src/domains/billing/categories.ts`:
```ts
export type LedgerCategory = "RENT"|"FEES"|"DEPOSIT"|"TAX"|"LATE_FEE"|"DISCOUNT"|"CREDIT"|"REFUND";
export function categorizeLine(kind: InvoiceLineItemKind): LedgerCategory;
export async function collectedBetween(customerId | null, from, to): Promise<{ grossCents; refundedCents; netCents; byMethod }>;  // from Receipts + Refunds by receivedOn/createdAt business date
```
"Actually collected" = receipts − refunds in the period (H2); the accounting export gets `receiptId`, `source`, `receivedOn` (business date) and includes overpayment receipts (H4/H5/M4); the earnings report uses the same basis on both sides of its comparison (H1) — state which basis in the column header. Statements: add a reconciliation footer: opening balance + invoices − receipts − credits applied + refunds = closing balance, asserted equal in the test fixture.
Tests: fixture with a refund, an unpaid invoice, a partially paid one and an overpayment → statement footer balances; export rows sum to receipts; collected excludes refunds.

### WU-B12 — Docs and PR
`docs/BUSINESS-RULES.md`: new "Ledger" section (receipts, allocations, credits, late-fee uniqueness, tax rounding, term boundary; policy fields and what null means). `docs/DATABASE.md`: tables from Section 2. `docs/ARCHITECTURE.md`: cron `billing-reconcile`, env unchanged. `docs/OWNER-INPUTS.md`: add IN-17 (tax precision beyond tenths, optional), IN-18 (run `scripts/backfill-receipts.ts --confirm` on production once, after merge — Chris or an agent with his go-ahead), IN-19 (termination/renewal policy values and texts — blocks Batch D UI, not this batch). `docs/STATUS.md`. PR per PLAYBOOK Step 7 with the Batch B acceptance checklist from `docs/PLAN.md`, each line pointing at a test file above.

## 5. Stop-and-ask points

Stop and ask Chris (through the report, with an IN- id) — do not guess:

1. Any assumption in Section 0 is false.
2. The migration drill shows an existing invoice with two LATE_FEE lines (the partial index cannot be created until that data is resolved — propose merging them, do not do it).
3. A `Payment` row that cannot be mapped to a single customer during backfill.
4. Anything that needs a live Stripe key, a real send, or a production write — all out of scope.
5. A policy value (fee, notice days, refund treatment) — never default it.

## 6. Acceptance mapping (copy into the PR)

| PLAN checklist line | Evidence |
|---|---|
| Provider-success/local-failure reconciliation | WU-B3/B4/B9 tests; `billing-reconciliation.test.ts` |
| No duplicate Stripe Customer / subscription / referral credit | integration tests in WU-B3, B4, B6 |
| Webhook out-of-order / unknown-state | existing `webhook-atomicity-integration.test.ts` unchanged + WU-B4 heal test |
| Late fee exactly once | WU-B8 integration |
| Write-off cannot override racing paid | WU-B7 integration |
| Gross/net/refund/deposit/tax/credit categories | WU-B11 `categories` tests |
| Overpayment → one receipt, no double-spendable credit | WU-B5 |
| Statement reconciles to detail | WU-B11 statement footer test |
| Fixed-term/renewal/termination/auto-renew no overlap, no double deposit | WU-B10 |
| Drift workbench read-only | WU-B9 "zero writes" test |
| Stripe test mode only | no key handling changed; `assertPreviewStripeKey` untouched |
| BUSINESS-RULES / DATABASE updated | WU-B12 |
