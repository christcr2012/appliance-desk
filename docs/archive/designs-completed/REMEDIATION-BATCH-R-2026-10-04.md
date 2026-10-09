> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-09.
> Nothing in this file is a current instruction; any "current", "next", "approved" or
> "supersedes" language below is historical. The batch is built: its behavior is in the
> code and tests. The working documents are `AGENTS.md`, `docs/SESSION-START.md`,
> `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# Remediation Batch R — review findings hardening

**Prepared:** 2026-10-04  
**Owner direction:** Chris asked to turn the two 2026-10-03 code reviews into one solid remediation batch.  
**Design authority:** this document is the implementation contract for the remediation work below.  
**Required implementation base:** the first code branch starts from `main` **after PR #175 is merged**. Do not stack this code on the 2026-10-04 reviewed `main`; #175 changes `jobs/completion.ts`, refunds, reconciliation, schema, and the missing-item subscription workflow.  
**Reviewed design baseline:** `main` `d7059a02b9618f0efce48ff8861b0ddc44317de1`; PR #175 head `c658a7dddb07b26b93c77206083102c940c19e30` was inspected for overlap.  
**Live gates remain unchanged:** Stripe test mode; live customer email/SMS OFF; automatic renewals stay OFF until their separate lifecycle gates are satisfied. This batch does not authorize production activation, spending, destructive production writes, or live messaging.

## 2026-10-04 Remediation R drift check

**Implementation base:** `main` `c471905b484bc7e360ce2f202ee4ad51ac632572`. PR #175 is merged; the only later merges (#176 and #177) are documentation-only, so there is no post-#175 code drift to rebase around.

**Review continuity:** all final #175 review surfaces were checked before remediation code. There are no inline review threads or submitted reviews. Codex reported its review quota exhausted, Copilot was recorded as out of review credits, and #175 recorded the repo-approved unavailable-review waiver after an independent diff check at exact head `9574373839e5f4ed8103313b53855066262fc06e`. There is therefore no late overlapping automated finding to add to R01–R17.

**#174 behavior:** the job-scoped STAFF authorization fence remains in `src/domains/inventory/guarded-status.ts` and job completion still calls `assertJobScopeInTx`; this stays verification-only and is not rebuilt.

**Finding drift:** all 17 findings remain actionable on this base.

- **R01:** `startRecurringBillingForAgreement` still returns `Promise<void>` and returns normally for blocked, failed, unknown, and retry-later states; `runHandoffs` still treats normal return as success.
- **R02:** `HandoffStatus` is still only `PENDING/DONE/FAILED`; `JobBillingHandoff` has no `claimedAt`; the worker only increments `attempts`, so it has no durable exclusive in-flight lease.
- **R03:** `completeJob` still creates `START_RECURRING_BILLING` for every delivery/installation agreement even when every result is `NOT_DELIVERED`.
- **R04:** `RentalAgreement` still has no `firstDeliveredOn`; subscription startup still derives term/billing timestamps from `billingStartedAt ?? new Date()` and provider execution time.
- **R05:** `startRenewalInTx` still moves assignments/deposit/subscription without first rejecting open old-agreement delivery, installation, or removal jobs; the SWAP exception therefore still needs current-lineage custody verification.
- **R06:** `Deposit` still moves `agreementId` on renewal and has no immutable `sourceReceiptId` relation.
- **R07:** the canonical success set exists, but money-critical reads still hard-code `status: "succeeded"`, including deposit/refund source resolution and webhook payment dedupe.
- **R08:** webhook processing still retains the broad transaction-scoped advisory serialization identified by the review; route-level provider recovery already exists outside the transaction and must be preserved while any remaining provider I/O is kept out of locked local apply work.
- **R09:** estimate approval/change-request paths still do not enforce `validUntil` under the locked response transaction.
- **R10:** initial estimate send still lacks a single locked claim/idempotent initial-send identity before external email work.
- **R11:** reviewed date-only input still contains direct `new Date(data.purchaseDate)` construction.
- **R12:** the job repair-cost parser still converts with `Number`, silently maps malformed values to null, and accepts negative/more-than-two-decimal values.
- **R13:** owner/admin inventory commands are not yet consistently one guarded transaction containing actor validation, row/state validation, business mutation, and audit; #174's separate job-scoped STAFF path remains preserved.
- **R14:** `createPurchaseOrder` still reads the supplier outside the transaction and writes the audit after the transaction.
- **R15:** `recordPartUsage` still calls `lastKnownPurchaseCostCents` before `applyPartMovementsInTx` acquires the part lock, so a concurrent receipt can win after the cost read and leave usage with stale cost.
- **R16:** PO receipt replay still infers identity from part movements/audit; free-text lines have no durable payload claim, so changed free-text payload can replay as if identical.
- **R17:** `getExceptions`/Today still contains broad historical request-path reads and in-memory filtering/sorting without the design's per-category bounds.

**Decision conflicts:** none found. #175's missing-item refund/line-reduction behavior is compatible with R03/R04: partial delivery still starts whole-agreement billing, while a true zero-delivery visit must not. The owner-confirmed tax-refund/unpaid-month rules in #177 do not change this design. Implementation may proceed. The Stripe delivery-anniversary sub-step remains subject to the explicit section 11 stop boundary if the installed Stripe API cannot preserve the delivery anchor without changing money policy.

---

## 0. Why this batch exists

This is a temporary hardening batch inserted **after Batch C's missing-item PR (#175) and before new Batch D feature work**. It converts the actionable findings from:

- `docs/reviews/2026-10-03-codebase-review.md` on `ai/sol/codebase-review-2026-10-03`; and
- `docs/reviews/2026-10-03-cross-system-code-review.md` on `ai/sol/cross-system-code-review-2026-10-03`

into one executable stack.

The first review had 12 findings. PR #174 materially fixed the old P1 finding that a historical `JobAppliance` row could act as permanent STAFF status-change authorization, so that item is **verification-only, not remediation scope** here. The other 11 findings remain. The second review adds 6 cross-system findings. Therefore this batch owns **17 actionable findings**.

The batch is not a generic cleanup. It is limited to correctness, money/provider recovery, lifecycle truth, atomic inventory/purchasing writes, input/date correctness, and scaling defects confirmed in current code.

---

## 1. Non-negotiable invariants

The implementer must preserve these across every slice:

1. **No provider success by implication.** “Function returned” is not equivalent to Stripe/email success. Provider-facing commands return or persist an explicit outcome.
2. **No duplicate logical operation under overlap.** Retryable work has one durable identity and one exclusive claim/lease at a time.
3. **Physical facts are immutable business facts.** Delivery/return dates, custody, current rental lineage, and original payment provenance do not get re-derived from a mutable relationship later.
4. **Billing never starts before the first real delivery.** A zero-delivery visit creates follow-up work, not recurring charges.
5. **History and current ownership are different concepts.** Renewal may move current liability/assignment while immutable origin/provenance remains traceable.
6. **Every privileged business mutation is one guarded command.** Active actor check + locks/current-state validation + mutation + audit commit together.
7. **Business dates are America/Denver dates.** HTML `YYYY-MM-DD` values do not go through `new Date("YYYY-MM-DD")`.
8. **Money parsers reject invalid money.** Bad input never silently becomes `null`; negative costs are never accepted unless a domain explicitly models a credit.
9. **Operational request paths are bounded.** Today/exception pages must not fetch and sort an unbounded business history in memory.
10. **No network call while holding a database transaction/row/advisory lock.** Provider reads/writes happen before or after the short local transaction and are reconciled with durable state.
11. **Current business behavior from #175 stays intact.** Same-type substitute delivery, never-delivered line amendments, subscription-line reconciliation, and their tests are not to be weakened or reimplemented.

---

## 2. Drift check — required before any code

After #175 merges, write a dated `2026-10-04/05 Remediation R drift check` at the top of this file before implementation.

Verify literally:

- `main` contains #175 and its final review fixes.
- PR #175 review threads have been read and valid findings that overlap this batch are folded into the appropriate slice.
- PR #174's STAFF authorization fix still exists; do not rebuild it.
- `startRecurringBillingForAgreement` still returns `void` / normal-return non-success states.
- `runHandoffs` still treats normal return as handoff success and has no exclusive in-flight lease.
- zero-delivery completion can still create a recurring-billing handoff.
- `RentalAgreement` still has no durable first-delivery business-date field.
- renewal can still leave a stale operational job tied to the prior agreement; the existing SWAP test that follows a renewed assignment still passes.
- `Deposit` still carries liability by changing `agreementId` on renewal and has no immutable source receipt/charge link.
- refund/payment reads still contain hard-coded successful-status spelling instead of the canonical success set.
- webhook transaction processing still uses the broad serialization pattern identified in the second review; inspect the route first because some identity recovery already happens outside the transaction.
- estimate response paths still do not enforce `validUntil` transactionally.
- initial estimate send still lacks a single atomic claim/idempotent initial-send contract.
- date-only actions still use direct JS date construction in any reviewed path.
- repair-cost parsing still accepts/normalizes invalid money.
- the reviewed inventory/purchasing commands still lack the guarded/atomic patterns named below.
- exception queries still have the unbounded/in-memory history behavior.

If #175 already fixes a finding, mark it **already fixed with exact code/test evidence** and remove only that work item; do not reimplement it.

A changed filename/function name is ordinary drift. A changed money rule, permission rule, state machine, or database ownership model is a decision-level conflict: stop that work unit and record the conflict rather than improvising.

---

## 3. Finding register

| ID | Severity | Finding | Original review |
|---|---|---|---|
| R01 | P1 | Job billing handoff can become `DONE` while provider work is failed/unknown/blocked/deferred | first P1-1 |
| R02 | P2 | Job billing handoff claim is not exclusive while work is in flight | first P2-1 |
| R03 | P1 | Zero-delivery visit can start recurring billing | second P1-3 |
| R04 | P2 | Real delivery business date is lost before recurring-billing/provider execution | second P2-1 |
| R05 | P1 | Renewal can leave stale jobs/custody/billing lineage | second P1-1 |
| R06 | P1 | Deposit liability moves on renewal but original Stripe payment provenance does not | second P1-2 |
| R07 | P1 | Refund/payment paths bypass canonical legacy successful-payment statuses | second P1-4 |
| R08 | P2 | Webhook/provider recovery can hold broad DB serialization across external work | second P2-2 |
| R09 | P1 | Expired estimates remain approvable/change-requestable | first P1-3 |
| R10 | P2 | Initial estimate send is not atomically claimed/idempotent | first P2-5 |
| R11 | P2 | Date-only form values bypass Colorado business-date helpers | first P2-3 |
| R12 | P2 | Repair cost inputs accept negative/invalid money and silently null bad values | first P2-4 |
| R13 | P2 | Inventory commands do not consistently use guarded transactional command pattern | first P2-2 |
| R14 | P2 | Purchase-order creation validates supplier/audit outside one transaction | first P2-7 |
| R15 | P2 | Part usage can record stale purchase cost during concurrent receipt | first P2-8 |
| R16 | P2 | PO receipt retry identity does not cover free-text line payload | first P2-9 |
| R17 | P2 | Today/exception inbox performs broad unbounded operational queries | first P2-6 |

Verification-only item, **not counted above**: first-review P1-2 historical STAFF `JobAppliance` provenance. PR #174 must remain covered by its tests.

---

# 4. Stack shape

Build this as **one batch with three substantial PRs**, stacked in this order. Do not create one PR per finding.

### R1 — Rental, billing handoff, provider and renewal truth

Branch suggestion: `ai/<agent>/remediation-r1-billing-lineage`  
Owns: **R01–R05**.

Why together: all five findings share the job-completion → physical-delivery → agreement/renewal → Stripe boundary. Fixing them separately would repeatedly rewrite the same functions and run the same expensive integration suite.

### R2 — Financial provenance, customer promises and boundary inputs

Branch suggestion: `ai/<agent>/remediation-r2-provenance-estimates`  
Owns: **R06–R12**.

Why together: these are places where the app tells the owner/customer that money, a quote, or a date means one thing while the durable provenance/input contract can mean another.

### R3 — Inventory/purchasing atomicity and operational scaling

Branch suggestion: `ai/<agent>/remediation-r3-ops-integrity`  
Owns: **R13–R17**.

Why together: these are non-provider operational writes and read paths that should converge on the same guarded/serialized patterns.

Each PR reads and dispositions the previous PR's Codex/Copilot/independent review before merge. Automated review quota failure is recorded honestly per `AGENTS.md`; it is never described as a completed review.

---

# 5. PR R1 — rental, billing handoff, provider and renewal truth

## R1-A — Explicit handoff outcome contract (R01)

### Current problem

`runHandoffs` treats a normal return from provider-facing functions as success even though those functions intentionally return normally for `RetryLater`, failed, blocked, and unknown provider states.

### Required design

Introduce a shared explicit result type near the job/billing handoff boundary:

```ts
export type HandoffWorkOutcome =
  | { state: "DONE"; detail?: string }
  | { state: "RETRY"; detail: string }
  | { state: "BLOCKED"; detail: string }
  | { state: "UNKNOWN"; detail: string };
```

`startRecurringBillingForAgreement` and `pushLateDeliveryCreditToStripe` must return an outcome (or a small adapter must translate their durable `ProviderOperation` result into this type). **Do not infer `DONE` from lack of an exception.**

Rules:

- confirmed success or a true terminal no-op already satisfied locally/provider-side → `DONE`;
- definite provider failure that is safe to retry → `RETRY`;
- missing customer setup/policy prerequisite → `BLOCKED`;
- ambiguous provider response → `UNKNOWN` and reconciliation, not blind replay.

The handoff row becomes `DONE` only for `DONE`.

## R1-B — Exclusive handoff lease (R02)

### Schema

Amend the existing enum/model rather than adding a second queue:

```prisma
enum HandoffStatus {
  PENDING
  IN_FLIGHT
  DONE
  FAILED
}

model JobBillingHandoff {
  // existing fields unchanged
  claimedAt DateTime?
}
```

Do not add a new queue table.

### Claim algorithm

- normal candidates: `PENDING`/`FAILED` below retry ceiling;
- stale recovery candidate: `IN_FLIGHT` with `claimedAt` older than the existing/provider-operation lease window (use one named constant; do not invent different lease durations in multiple files);
- claim with one conditional update that sets `IN_FLIGHT`, stamps `claimedAt`, and increments `attempts`;
- the resulting attempt number is the lease identity: final writes include `id`, `status: IN_FLIGHT`, and that expected `attempts` value;
- a worker that lost the lease cannot overwrite a newer attempt;
- `DONE` clears `claimedAt`; retryable/failed completion clears `claimedAt` and sets `FAILED`; ambiguous provider state is not represented as a false `DONE`.

Real-Postgres overlap test: pause worker A after claim; worker B must not own/execute the same handoff.

## R1-C — First real delivery is the billing fact (R03 + R04)

### Schema

Add one durable physical/business fact to `RentalAgreement`:

```prisma
firstDeliveredOn DateTime?
```

Semantics: Colorado business-date midnight representing the **first successful physical delivery/installation of at least one rental appliance on this agreement lineage**. It is write-once for that agreement. This is not provider confirmation time.

Migration/backfill: for old rows where `billingStartedAt IS NOT NULL` and `firstDeliveredOn IS NULL`, use `billingStartedAt` as the best-known historical approximation and document that approximation in `docs/DATABASE.md`. Do not invent a delivery date for agreements that never billed.

### Completion behavior

Inside `completeJob`, after the scope/results are locked and before handoff creation:

- if delivery/installation has **zero** `DELIVERED` results: do not set `firstDeliveredOn`; do not create `START_RECURRING_BILLING`;
- if it has one or more `DELIVERED`: set `firstDeliveredOn` if null to the already-computed `serviceDate`; do not overwrite it on a later delivery;
- true partial delivery (some delivered, some not) still starts whole-agreement billing and keeps #175's missing-item/substitution/credit behavior.

### Billing starter behavior

`startRecurringBillingForAgreement` defensively re-reads `firstDeliveredOn` under the agreement lock. If no first-delivery fact exists, return a non-success handoff outcome and **do not** create a subscription.

When subscription creation is delayed by a retry/provider outage:

- local revenue/term calculations use the immutable business anchor, not provider call time;
- `billingStartedAt` is written from `firstDeliveredOn` when billing is confirmed, not `new Date()`;
- fixed-term `endDate` is derived from the business anchor, not retry time.

Stripe-specific implementation must be verified against the repository's installed Stripe version. Current Stripe API docs expose `backdate_start_date` and `billing_cycle_anchor` on subscription creation; use an API-supported combination that preserves the intended delivery-based cycle without double-charging past time. If the installed API/version prevents a safe exact anchor, stop this narrow provider sub-step and document the conflict instead of approximating silently. Local `firstDeliveredOn` remains authoritative regardless.

Do not turn a provider outage into a later business delivery date.

## R1-D — Renewal/job lineage fails closed (R05)

This work must **not** invent C-09 pickup billing policy.

### Renewal-start gate

Before `startRenewalInTx` moves assignments and activates the renewal, inspect open `SCHEDULED`/`IN_PROGRESS` jobs tied to the old agreement.

- an open `REMOVAL`, `DELIVERY`, or `INSTALLATION` tied to the old agreement is an operational conflict: return a new explicit `RenewalStartResult` reason such as `OPEN_JOB_CONFLICT` with an owner-readable message to resolve/cancel/complete the visit first;
- do not silently start the renewal and leave a stale custody-changing job behind;
- SWAP remains allowed because the existing Batch C rule intentionally lets a staged swap follow the appliance's current assignment across renewal;
- maintenance visits may remain if they do not mutate rental-line ownership; their customer/property authorization still applies.

This is deliberately fail-closed rather than guessing whether an old pickup should now cancel a renewed rental.

### Completion lineage

For any custody/assignment mutation, derive current assignment/custody under the existing canonical lock order. A stale job must not mutate an appliance now belonging to a different active agreement unless the workflow explicitly supports following current lineage.

### SWAP exception fix

The SWAP path already follows the original appliance's current assignment after renewal. When opening replacement custody, use that **current assignment's agreement lineage** (and matching customer/property), not the stale `before.agreementId` captured when the job was staged.

### Tests

Real Postgres:

- renewal refuses to start while old agreement has an open removal;
- renewal refuses open delivery/installation conflict;
- cancelling/resolving the conflict allows renewal start;
- staged swap still survives renewal and replacement assignment + custody both reference the renewal/current lineage;
- stale non-swap custody-changing completion rolls back fully rather than producing active-agreement/returned-appliance contradiction.

## R1-E — R1 acceptance

Required tests/evidence:

- provider FAILED, UNKNOWN, blocked, RetryLater never mark handoff `DONE`;
- confirmed provider success marks `DONE` once;
- overlapping handoff workers execute one claim;
- stale handoff lease can be recovered once;
- all-NOT_DELIVERED visit creates no billing-start intent;
- later real delivery starts billing once;
- partial delivery keeps #175 credit/substitute semantics;
- delayed provider completion preserves the recorded delivery business date locally;
- fixed term derives from delivery date, not retry date;
- renewal/open-job conflict tests above;
- existing #175 subscription-line/substitute tests stay green;
- existing #174 STAFF permission tests stay green.

Docs: `BUSINESS-RULES.md`, `DATABASE.md`, `ARCHITECTURE.md` if Stripe-anchor behavior changes, backup schema policy for new column/enum.

---

# 6. PR R2 — financial provenance, customer promises and boundary inputs

## R2-A — Immutable deposit source receipt (R06)

### Schema

Do not stop moving the deposit liability to the current renewal; that behavior is useful. Instead preserve immutable payment origin.

Add to `Deposit`:

```prisma
sourceReceiptId String? @unique
sourceReceipt   Receipt? @relation(fields: [sourceReceiptId], references: [id], onDelete: Restrict)
```

Add the corresponding optional back-relation on `Receipt`.

`sourceReceiptId` means: the receipt containing the money from which this deposit liability was originally funded. It does **not** change when `Deposit.agreementId` moves across renewals.

For Stripe receipts, `Receipt.stripeChargeId` is the refund rail. Manual/cash/check deposits may legitimately have `sourceReceiptId = null` or a non-Stripe receipt.

### Population

Update every real deposit-creation path:

- deposit created from Stripe estimate/signing payment: attach the durable Receipt when the receipt is created/known;
- normal Stripe-backed deposit invoice/payment: attach its Receipt;
- manual deposit: attach its Receipt if one exists; no Stripe charge is invented.

Migration/backfill: link unambiguous existing deposits to the earliest matching deposit payment/receipt on their current agreement. Runtime compatibility for historical renewed rows may walk `renewedFromAgreementId` backward to locate the original deposit receipt; once found, persist `sourceReceiptId` under a lock. Do not rely on lineage walking for newly created data.

### Refund/reconciliation behavior

`decideDepositRefund` and refund reconciliation resolve payment rail in this order:

1. immutable `sourceReceiptId` → Receipt;
2. legacy compatibility recovery/backfill;
3. manual path only when durable evidence proves there is no Stripe source.

A missing source on a deposit that appears card-funded is an owner-visible reconciliation problem, not silent `returnMethod: "manual"`.

Tests: A→B and A→B→C renewals; estimate deposit; ordinary agreement deposit; manual deposit; UNKNOWN/FAILED refund recovery.

## R2-B — Canonical successful payment status everywhere (R07)

Audit money-critical Payment reads, especially:

- `resolveDepositStripeCharge` / its replacement;
- `issueInvoiceRefund` / #175 refactor equivalents;
- webhook one-time charge dedupe;
- any refund-capacity calculation touched by #175.

Use `SUCCESSFUL_PAYMENT_STATUSES` (or the canonical helper) for historical success. Do not rewrite historical rows solely to normalize case.

Provider identity (`stripePaymentIntentId`, receipt/charge IDs) is independent of legacy status spelling.

Run paired regression fixtures using both `"succeeded"` and `"SUCCEEDED"`.

## R2-C — Short webhook transactions; no provider I/O under DB serialization (R08)

Read `src/app/api/webhooks/stripe/route.ts` before changing `webhooks.ts`: subscription identity healing already has some provider work outside the transaction.

Required end state:

- signature verification and any required Stripe/provider evidence fetch happen **outside** Prisma transactions;
- the short local apply transaction acquires only the serialization required for local state, re-checks current rows, applies the event atomically, and inserts `WebhookEvent` in the same transaction;
- no `getStripeClient()`/Stripe await occurs inside the transaction callback;
- duplicate event ID remains exactly-once locally;
- a local transaction failure leaves no `WebhookEvent` success marker so Stripe retry is safe;
- provider evidence fetched before the lock is treated as evidence, not authority: local state is rechecked under lock before mutation;
- do not remove delayed-settlement/ACH protections or out-of-order subscription recovery tests.

Prefer narrower customer/invoice serialization where the existing invariants allow it. If the global advisory lock is still required for a local cross-customer invariant, it may remain **only for the short local transaction**, never across network latency.

Add a test that injects slow provider evidence retrieval and proves it occurs before transaction-local write/lock execution, plus existing duplicate/out-of-order real-Postgres tests.

## R2-D — Estimate validity is enforced transactionally (R09 + R11 estimate half)

Define `Estimate.validUntil` as **valid through that America/Denver business date**.

Input:

- strict `YYYY-MM-DD`;
- parse using the canonical business-date helper (`businessDateEnd` for a valid-through deadline), never `new Date(dateString)`.

Approval/change request:

- lock the Estimate row first;
- compare against the same deterministic business instant;
- if past deadline and status is still awaiting customer response, transition to `EXPIRED` in the same transaction;
- reject approval/change request;
- no conversion/deposit/customer side effect occurs after expiry.

Public page:

- same server rule determines actionability;
- expired estimate renders a clear non-actionable state;
- format with business-date helpers, not runtime-local formatting.

Boundary tests include winter, summer, DST transition weeks, exact valid-through end, and one instant after.

## R2-E — Initial estimate send is a single claimed transition (R10)

Do not build Batch E's full communication ledger here.

Use the Estimate state transition itself as the claim:

1. one DB transaction locks the estimate and verifies it is in the exact owner-editable/sendable state;
2. transition to the sent state and persist a unique `sentAt` **before** external email work;
3. only the transaction winner sends;
4. use deterministic Resend idempotency key derived from estimate id + persisted `sentAt` (or a persisted send revision if #175/current code already has one);
5. `sendEmail` result is inspected; `UNKNOWN` is never blindly auto-replayed;
6. definite non-send/unknown outcome creates owner-visible evidence (audit and existing task/exception mechanism) rather than pretending delivery was confirmed;
7. a deliberate re-send is a new, explicit owner action with a new persisted send identity; two concurrent clicks still produce one logical send for that identity.

Do not send email inside the transaction.

Tests: concurrent sends → one provider call; SENT; REJECTED; NOT_ATTEMPTED; UNKNOWN; explicit resend; same idempotency identity on a retry of the same claimed send.

## R2-F — Strict date-only parsing everywhere reviewed (R11 remainder)

Replace direct `new Date("YYYY-MM-DD")` usage for reviewed business fields such as appliance `purchaseDate` with strict canonical helpers.

Choose start-of-business-date vs end-of-business-date by field meaning and document it once. Rendering uses business date formatters.

Search the touched domains for the same anti-pattern; fix only equivalent business-date fields, not arbitrary ISO timestamps.

## R2-G — Strict repair-cost money parser (R12)

Replace `dollarsToCentsOrNull` behavior with an explicit parser:

- blank string → `null` only when clearing is allowed;
- malformed value → validation error;
- negative → validation error;
- more than two decimal places → validation error (do not silently round owner-entered accounting input);
- finite integer cents only;
- set a defensive upper bound consistent with the app's integer-money conventions;
- `setJobRepairCosts` repeats the non-negative/integer invariant so direct domain calls cannot bypass the form.

Tests: `-1`, `abc`, `1.001` reject; `123.45` → `12345`; blank → `null`; direct negative domain call rejects; existing itemized-parts double-count guard remains.

## R2-H — R2 acceptance

- deposit refund still reaches original Stripe charge after one and multiple renewals;
- manual deposits never create a Stripe refund;
- lowercase/uppercase historical success produce identical money outcomes;
- no Stripe call occurs inside webhook transaction callback;
- duplicate/out-of-order/delayed settlement webhook tests remain green;
- expired estimate cannot approve/change/convert;
- concurrent initial send produces one message attempt;
- Denver date-only tests pass across DST;
- repair cost parser/domain invariants pass.

Docs: `DATABASE.md`, `BUSINESS-RULES.md`, owner-visible wording where applicable, backup policy for new relation.

---

# 7. PR R3 — inventory/purchasing atomicity and operational scaling

## R3-A — Standard guarded inventory command (R13)

Bring these reviewed commands onto one pattern where they are not already fixed after #175:

- `createApplianceUnits`
- `updateApplianceDetails`
- manual `updateApplianceStatus`
- `addAppliancePhoto`
- `startRepairForAppliance`
- `retireAppliance`
- `recordApplianceInspection`

Pattern:

```text
transaction
  -> assertActiveTeamActor(tx, userId, allowedRoles)
  -> lock/read current record(s) in canonical order
  -> validate version/lifecycle/custody
  -> mutate
  -> audit/evidence write
commit
```

Preserve PR #174 job-scoped STAFF authority. Do not reopen a generic STAFF status-change path.

Business mutation and audit must roll back together. Preserve optimistic concurrency on detail/status/inspection records.

## R3-B — PO creation is one guarded transaction (R14)

`createPurchaseOrder` becomes one transaction:

1. `assertActiveTeamActor`;
2. lock/re-read Supplier and reject archived;
3. lock referenced PartRecord rows in sorted id order and reject archived/invalid;
4. create PO + lines;
5. audit;
6. commit.

Supplier archival and PO creation must use a compatible lock order. Add real-Postgres archive-vs-create race test. Audit failure test proves no PO remains.

## R3-C — Usage cost is derived after the part lock (R15)

`recordPartUsage` must acquire the PartRecord lock **before** reading last-known purchase cost, and hold that lock through the usage ledger write.

A concurrent receipt that wins first must become visible to usage cost; a usage that wins first legitimately uses the prior cost. Test both controlled orderings with real Postgres.

Do not introduce a second stock truth; `PartStockMovement` remains canonical.

## R3-D — Durable PO receipt operation identity (R16)

Add one small business-operation model rather than overloading AuditLog or part movements for free-text receipt identity:

```prisma
model PurchaseOrderReceiptOperation {
  id              String   @id @default(cuid())
  operationKey    String   @unique
  purchaseOrderId String
  payloadHash     String
  createdAt       DateTime @default(now())

  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
}
```

Add the back-relation and backup/schema policy.

Canonical payload hash:

- SHA-256 of a stable serialization;
- includes purchase order id;
- includes every submitted line sorted by line id;
- includes line id, receive quantity, and submitted unit cost/unknown marker;
- includes free-text/no-PartRecord lines exactly like stocked lines;
- excludes non-business transport noise such as form ordering.

Inside the receipt transaction, atomically claim `operationKey`. Same key + same hash is replay; same key + different hash is a conflict. A failed transaction must not leave a completed claim.

Use `INSERT ... ON CONFLICT DO NOTHING RETURNING` or an equivalent transaction-safe claim; do not catch a Prisma unique violation and continue in an aborted Postgres transaction.

Tests:

- same key + same stocked payload replays;
- same key + same free-text payload replays;
- same key + different free-text quantity rejects;
- same key + different price/unknown state rejects;
- new key permits a genuine later partial receipt;
- concurrency creates one receipt effect.

## R3-E — Bounded exception/Today queries (R17)

Refactor `getExceptions`/related operational reads so each category is bounded and deterministic.

Rules:

- no unbounded `findMany` of historical business tables on the request path;
- default per-category item cap: **50** (technical safety constant, not owner policy);
- return total count / `hasMore` separately where the UI needs to show that more exist;
- ordering includes a stable tie-breaker id;
- “latest maintenance” is selected in SQL/Prisma with `orderBy + take: 1` or a set-based query, not by loading all history per appliance and sorting in JS;
- Today still shows the highest-risk/oldest actionable items first according to the existing business ordering; do not change business priority merely to paginate;
- no N+1 provider/network calls.

Large-fixture test proves result rows remain bounded and deterministic as historical volume grows.

## R3-F — R3 acceptance

- inventory business write rolls back when audit/evidence fails;
- actor deactivation fence is honored inside transaction;
- stale edits still conflict;
- supplier archive vs PO create has exactly one safe outcome;
- part receipt vs usage produces cost based on lock winner, never stale post-receipt cost;
- receipt idempotency covers free-text payload completely;
- exception query output is bounded with stable ordering/counts;
- all #175 purchasing/billing-adjacent tests remain green.

---

# 8. Cross-batch tests that must exist before Batch R is complete

These are the high-value whole-flow scenarios; naming may differ but behavior may not.

1. **First delivery/retry:** zero delivered → no subscription; later one delivered → one durable handoff; simulated provider UNKNOWN → no false DONE; reconciliation → DONE; business anchor stays original delivery date.
2. **Renewal + field work:** staged SWAP → renewal → swap; custody/assignment agree on current agreement. Open removal → renewal refuses to start until conflict resolved.
3. **Deposit after multiple renewals:** Stripe deposit on A → B → C → refund; refund uses A's original Receipt/charge exactly once.
4. **Legacy payment compatibility:** duplicate fixtures differing only by `succeeded` vs `SUCCEEDED` produce identical refund/dedupe/report behavior.
5. **Estimate race and expiry:** two send clicks → one send identity/provider call; approval at/after Colorado expiry boundary behaves deterministically.
6. **Purchasing races:** supplier archive/create PO; receipt/use part; duplicate receipt op with changed free-text payload.
7. **Authorization rollback:** deactivated actor cannot win an inventory mutation; audit failure rolls back the business write.

Use real throwaway Postgres for race/transaction tests. Stripe/email are simulated/faked provider boundaries; no live external money/messages.

---

# 9. Documentation and reconciliation requirements

Each PR must update only the docs that its behavior actually changes.

At final R3 merge:

- add a short Batch R entry to `docs/STATUS.md` with all 17 finding IDs and merged PR evidence;
- update `docs/designs/CHANGES-SINCE-DESIGN.md` because D was designed before these contract changes;
- specifically tell Batch D that:
  - `RentalAgreement.firstDeliveredOn` exists;
  - deposit refunds resolve through immutable `sourceReceiptId`;
  - estimate expiry/send semantics are stronger;
  - webhook/provider calls may no longer occur under DB locks;
  - inventory mutations use the guarded command pattern;
  - `PurchaseOrderReceiptOperation` is the receipt idempotency source;
- update the two review reports' dispositions **without rewriting their historical findings**: make a new acceptance/disposition document mapping R01–R17 to commit/test evidence;
- mark first-review STAFF provenance finding as fixed by #174 with evidence, not by Batch R;
- do not mark unrelated Batch B renewal R1/R2/R3/R4/R6/D2 or C-09 policy work complete unless this batch actually closes them by explicit evidence.

Suggested acceptance ledger: `docs/reviews/2026-10-04-remediation-batch-r-acceptance.md`.

---

# 10. Merge gates

Every slice inherits `AGENTS.md` and `docs/AI-PR-READ-FIRST.md`.

Before each merge:

- exact-head typecheck/lint/focused tests;
- full CI green at exact head;
- migration check/upgrade drill for schema PRs;
- preview check for any touched owner/customer UI;
- read previous/current Codex + Copilot + independent review; disposition every valid thread;
- if automated reviewer quota is unavailable, record the actual quota failure and perform the required independent diff review; do not claim it ran;
- no live Stripe/email/SMS;
- no fixtures against production;
- retarget stacked PR to `main` before merge per repo rules.

Do **not** merge a slice with an unresolved money, security, custody, or data-loss finding introduced by that slice.

---

# 11. Stop-and-ask boundaries

Implementation should not need new owner policy. Stop only for a true decision conflict, including:

- #175's final code changes the missing-item money rule in a way that conflicts with R03/R04;
- preserving the actual delivery billing anniversary in the installed Stripe API would necessarily double-charge, forgive charges, or otherwise require a new money policy;
- a renewal/open-job case cannot be made fail-closed without choosing whether to terminate/continue a customer's contract;
- existing production data contradicts a provenance backfill (do not guess original payment source);
- a supplier/part lock-order conflict is found with another existing command and there is no obvious canonical ordering;
- any fix requires turning on live provider behavior.

Everything else in this document is implementation detail already decided by the confirmed defects and existing business rules.

---

# 12. Definition of done for Remediation Batch R

Batch R is complete only when:

- R01–R17 each have a disposition of **fixed** or **already fixed after the reviewed baseline**, with exact code/test evidence;
- first-review historical STAFF authorization issue remains fixed by #174;
- all three remediation PRs are merged to `main` in order;
- all schema migrations are additive/safe and upgrade-drill green;
- whole-flow tests in section 8 pass;
- `docs/STATUS.md`, `CHANGES-SINCE-DESIGN.md`, `BUSINESS-RULES.md`, `DATABASE.md`, and acceptance ledger reflect actual merged behavior;
- automatic renewals and live customer communication gates have not been accidentally enabled;
- C-09 and later D/E/F work are re-evaluated against the new contracts before implementation.

Only then should the project proceed into remaining C-09 / Batch D feature work.