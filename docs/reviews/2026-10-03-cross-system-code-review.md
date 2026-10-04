# Cross-System Code Review — Appliance Desk (Second Pass)

**Review date:** 2026-10-03 (America/Denver)  
**Reviewed baseline:** `main` at `d7059a02b9618f0efce48ff8861b0ddc44317de1` (includes PR #174)  
**Review standard:** `.github/skills/code-review/SKILL.md`  
**Prior baseline:** `docs/reviews/2026-10-03-codebase-review.md` on `ai/sol/codebase-review-2026-10-03`  
**Review type:** cross-domain / adversarial workflow / data-integrity / production-recovery review

## Purpose

This is deliberately **not a repeat of the first code review**. The first review remains the baseline for function-level defects. This pass asks a different question:

> Where can two individually-correct parts of Appliance Desk disagree with each other and produce a wrong business outcome?

The review traced state and identifiers across agreement lifecycle, renewal, jobs, custody, billing, Stripe, deposits/refunds, customer-facing state, and recovery paths. Historical audit text was used only as a lead; findings below are based on current code at the reviewed SHA.

I did **not** execute the full test suite or a live Stripe flow. Existing unit/integration tests were inspected to understand intended behavior and identify missing scenarios. Concurrency/recovery recommendations below should be proved with the repository's real-Postgres test pattern before merge.

## Executive summary

New actionable findings in this second pass:

- **P0:** 0
- **P1:** 4
- **P2:** 2

The most important theme is **provenance loss at subsystem boundaries**. Renewal changes which agreement owns equipment and deposit liability, while open jobs and refund discovery still use identifiers that describe the old state. Job completion also reduces a real-world delivery event to a generic `agreementId` before handing work to billing, losing whether anything was actually delivered and the business date on which it happened.

The codebase already has strong local protections—row locks, provider operations, custody episodes, version checks, Stripe idempotency, customer-ledger serialization, and real-Postgres race tests. The next quality step is to make those protections agree on **lineage, origin, and effective business date** across domain boundaries.

---

# New confirmed findings

## P1-1 — Renewal can leave open jobs authorized against stale agreement lineage

**Primary locations**

- `src/domains/agreements/renewal-start.ts` — `startRenewalInTx`
- `src/domains/jobs/index.ts` — `createJobInTx`
- `src/domains/jobs/completion.ts` — `completeJob`
- `src/domains/jobs/scope.ts` — job-scoped authorization
- `src/domains/inventory/custody.ts`

### Trigger

1. Agreement A is ACTIVE and an appliance is physically with the customer.
2. A SCHEDULED/IN_PROGRESS job is created against Agreement A. `createJobInTx` verifies customer/property ownership, but does not require an agreement lifecycle state or establish a durable rule for what happens if agreement lineage later changes.
3. A signed renewal B starts.
4. `startRenewalInTx` ends A, activates B, and moves every open `ApplianceAssignment` from A's lines to B's corresponding lines. Custody intentionally stays open because nothing physically moved.
5. The old job still contains `agreementId = A` and remains runnable.

### Failure mode

For a REMOVAL job, `completeJob` validates that the open custody holder is the same customer, but does **not** require the appliance's current active assignment to still belong to the job's agreement. It can therefore:

- move the appliance to `AWAITING_INSPECTION`,
- close physical custody,
- record late-return billing against old Agreement A,
- complete the old job,

while the appliance still has an open assignment under ACTIVE renewal B and B's subscription/billing can remain active.

That leaves the system saying, simultaneously, that:

- renewal B is active,
- the appliance is assigned to B,
- the appliance is back in the shop,
- the customer no longer has custody,
- and B may continue billing.

The same root cause is visible in SWAP handling. SWAP completion correctly finds the original appliance's **current** assignment after a renewal and creates the replacement assignment on that current line, but the replacement custody episode is still opened with `agreementId: before.agreementId`—the stale agreement stored on the job. The assignment and custody provenance can therefore describe different agreements after a renewal.

### Business consequence

This can produce a physically impossible rental record, continue billing after equipment has been collected, attach return charges to the wrong term, and make later support/reconciliation depend on manual forensic work.

### Recommended fix

Make agreement-lineage reconciliation an explicit part of renewal/job boundaries rather than relying on the job's original foreign key forever.

At minimum:

1. During `startRenewalInTx`, inspect open jobs tied to the old agreement and explicitly **retarget, cancel, or block** them according to type. A removal/pickup that contradicts the renewal should not silently survive.
2. At completion, any job that changes custody or assignment must derive and lock the appliance's **current rental lineage** and prove the requested action is still valid for that lineage.
3. Where a job is intentionally allowed to survive renewal (for example the existing swap design), use the current assignment's agreement/service address for new custody provenance rather than `before.agreementId`.
4. Audit any automatic retarget/cancel decision so the owner can see why a visit changed.

### Required regression tests

Real Postgres:

- ACTIVE A + rented appliance + open REMOVAL job → renewal B starts → old removal cannot return the appliance while leaving B active/assigned.
- If policy is to cancel the old removal, assert the job is cancelled and equipment/custody remain consistent.
- If policy is to retarget it, assert all billing, assignment, custody, and job lineage point to B.
- Staged SWAP → renewal starts → swap completes → replacement assignment **and custody episode** both reference the renewal lineage.
- Pending DELIVERY created on A → renewal starts → stale job is either deliberately retargeted/cancelled or fails with a recoverable owner-visible state, never an orphaned dead job.

---

## P1-2 — Deposit liability moves to a renewal, but the original Stripe payment provenance does not

**Primary locations**

- `src/domains/agreements/renewal-start.ts` — `startRenewalInTx`
- `src/domains/agreements/renewal-data.ts` — `renewalCreateData`
- `src/domains/billing/refunds.ts` — `resolveDepositStripeCharge`, `decideDepositRefund`
- `src/domains/billing/reconciliation.ts` — `resolveDepositRefundCharge`

### Trigger

A customer pays a security deposit through Stripe on Agreement A, then renews.

`startRenewalInTx` intentionally carries the liability forward by changing the existing `Deposit.agreementId` from A to renewal B:

```ts
await tx.deposit.updateMany({
  where: { agreementId: old.id },
  data: { agreementId: renewal.id },
});
```

That is reasonable for liability ownership, but the original invoice/payment/receipt remain historical records on Agreement A.

### Failure mode

`resolveDepositStripeCharge` later tries to recover the charge by looking for a successful Stripe-backed Payment whose **invoice belongs to `deposit.agreementId`**. After renewal, that is B, while the real deposit invoice/payment remains on A.

Its fallback uses `deposit.agreement.sourceEstimateId`, but `renewalCreateData` intentionally creates the renewal as a new agreement and does not copy the original agreement's `sourceEstimateId`.

So a genuine Stripe-funded deposit can become indistinguishable from a manual/cash deposit after a normal renewal.

`decideDepositRefund` then records the deposit refund decision with:

- `returnMethod: "manual"`,
- no `REFUND_CREATE` provider operation,
- and no Stripe refund attempt.

The reconciliation path has the same lineage dependency: it correctly uses the canonical successful-payment status list, but it still searches by the deposit's **current agreement**, so it cannot reconstruct a charge that became unreachable because liability moved to a new agreement.

### Business consequence

At the exact moment deposits are normally returned—after the final rental term—the owner can record a deposit as refunded locally while the customer's original card has not actually received the money. The local liability ledger and Stripe cash movement can disagree without an obvious error.

### Recommended fix

Separate **current liability ownership** from **immutable payment origin**.

Preferred direction:

- persist a stable source on `Deposit`, such as original receipt/payment/Stripe charge plus original agreement/estimate provenance; or
- maintain a durable deposit-liability lineage record that carries forward across renewals without rewriting the origin.

Do not infer the refund rail from the deposit's mutable current `agreementId`.

A less invasive compatibility fix may walk `renewedFromAgreementId` backward to the original deposit invoice/payment, but a first-class immutable origin is safer and easier to reconcile after multiple renewals.

### Required regression tests

- Stripe signing deposit on A → renewal B starts → deposit refund finds A's original charge and creates one durable `REFUND_CREATE` operation.
- Same scenario across A → B → C multiple renewals.
- Estimate deposit collected before agreement creation → agreement → renewal → final refund still resolves the original Stripe charge.
- Manual/cash deposit continues to produce a manual refund path and never invents a Stripe operation.
- Failed/UNKNOWN refund operation remains recoverable after renewal through reconciliation.

---

## P1-3 — A delivery where **nothing is delivered** still starts recurring billing

**Primary locations**

- `src/domains/jobs/completion.ts` — `completeJob`
- `src/domains/billing/checkout.ts` — `startRecurringBillingForAgreement`
- `src/domains/billing/pickup-billing-events.ts`
- `src/app/desk/settings/pickup-billing-form.tsx`
- `tests/job-completion-integration.test.ts`

### Trigger

A DELIVERY or INSTALLATION job is completed with every appliance result equal to `NOT_DELIVERED`.

This is a valid per-appliance result and correctly creates follow-up work.

### Failure mode

`completeJob` creates a `START_RECURRING_BILLING` handoff for **every** delivery/installation job with an agreement:

```ts
if (isDelivery && before.agreementId) {
  handoffRows.push({
    jobId: before.id,
    kind: "START_RECURRING_BILLING",
    subjectId: before.agreementId,
  });
}
```

It does not require `deliveredIds.length > 0`.

`startRecurringBillingForAgreement` does not independently prove that an appliance actually entered customer custody; with a usable payment method, it can create the recurring Stripe subscription for the whole agreement.

The documented partial-delivery rule is different: when **one or more** appliances are missing on the visit that starts billing, the whole agreement bills from the **first delivery date**, and missing items receive later-delivery credit. That rule presupposes a first actual delivery. If every item is `NOT_DELIVERED`, there is no first delivery yet.

### Business consequence

A customer can begin recurring charges for the full rental even though they received zero equipment. The existing late-delivery-credit mechanism is designed to compensate missing items after billing has legitimately begun, not to define a zero-delivery visit as the billing start.

### Recommended fix

Create `START_RECURRING_BILLING` only when this completion contains at least one real `DELIVERED` result that opens customer custody (or when another explicit business event proves billing should start).

Preserve the current intended rule for a true partial delivery:

- 1+ delivered → start whole-agreement billing once;
- missing items → pending-delivery rows / credits;
- 0 delivered → no recurring-billing handoff; reschedule/follow-up only.

The billing starter should also defensively verify the persisted first-delivery fact rather than trusting only the caller.

### Required regression tests

- Two-item delivery, both `NOT_DELIVERED` → no billing handoff, no subscription, no `billingStartedAt`, no fixed-term billing start mutation.
- Later visit actually delivers an item → billing starts exactly once.
- One `DELIVERED` + one `NOT_DELIVERED` → existing whole-agreement billing behavior remains and the missing item retains its credit workflow.
- Concurrent/replayed completion cannot create duplicate billing start intent.

---

## P1-4 — Refund paths bypass the canonical legacy-success status rule and can treat Stripe money as manual

**Primary locations**

- `src/domains/billing/payment-status.ts`
- `src/domains/billing/refunds.ts` — `resolveDepositStripeCharge`, `issueInvoiceRefund`
- `src/domains/billing/webhooks.ts` — `recordOneTimeSigningCharge`

### Trigger

The database contains historical successful Payment rows using the legacy uppercase status `"SUCCEEDED"`.

The codebase already documents the compatibility invariant in `payment-status.ts`: both `"succeeded"` and `"SUCCEEDED"` are successful historical values and history is not rewritten. Money readers/checks are expected to use `SUCCESSFUL_PAYMENT_STATUSES`.

### Failure mode

Several money-critical paths still hard-code lowercase `"succeeded"`:

1. `resolveDepositStripeCharge` ignores an uppercase successful deposit payment and can fall through to the manual refund path.
2. `issueInvoiceRefund` ignores uppercase Stripe-backed payment allocations while `invoice.amountPaidCents` still says the invoice was paid. It can therefore create a local Refund row with **no Stripe charge selected and no provider refund operation**.
3. `recordOneTimeSigningCharge` uses lowercase status as part of its provider-payment dedupe lookup. Provider identity should not stop being recognizable because a historical status spelling differs.

`billing/reconciliation.ts` already uses the canonical status list for its deposit recovery query, which confirms this is implementation drift rather than a new policy choice.

### Business consequence

A valid historical card payment can be refunded only in the local database while no cash is returned through Stripe. It also weakens replay/deduplication around old provider payments.

### Recommended fix

- Replace hard-coded success spelling in all historical-payment reads with the canonical helper/set.
- Audit every `Payment.status` query in money/refund/webhook/reporting code for the same drift.
- Treat provider payment identity (`paymentIntentId` / receipt / charge) as independent from presentation-era status spelling.
- Where feasible, add a durable uniqueness/idempotency invariant for external payment identity instead of relying only on a status-filtered lookup.

### Required regression tests

Run every relevant scenario with both historical spellings:

- deposit refund resolves Stripe charge for `succeeded` and `SUCCEEDED`;
- invoice cash refund produces the same provider operation for both;
- statement/report totals remain unchanged;
- provider payment replay/deduplication recognizes a previously recorded uppercase-success payment.

---

## P2-1 — Job completion records the real service date, but recurring billing discards it at the handoff

**Primary locations**

- `src/domains/jobs/completion.ts`
- `src/domains/billing/pickup-billing-events.ts` — `jobServiceDate`
- `src/domains/billing/checkout.ts` — `startRecurringBillingForAgreement`
- `src/domains/billing/revenue.ts`
- `prisma/schema.prisma` — `Job.performedOn`, `RentalAgreement.billingStartedAt`

### Trigger

The physical delivery happened on one business date, but the job is completed/processed later—for example:

- staff records `performedOn` yesterday,
- the scheduled visit was yesterday but completion is entered today,
- or Stripe/provider recovery causes the billing handoff to succeed days later.

### Failure mode

Job completion correctly computes a business `serviceDate` from the recorded work date/scheduled date/completion fallback. Late-delivery and pickup billing use that date.

But the durable billing handoff stores only `subjectId = agreementId`. The service date is lost.

`startRecurringBillingForAgreement` later derives billing timing from existing `billingStartedAt` or `new Date()` and records `billingStartedAt` when provider work succeeds. That means:

- custody/late-delivery accounting can say delivery happened on Monday,
- recurring billing/MRR/fixed-term calculations can say billing began Tuesday or Friday,
- and a provider retry can move the apparent anniversary away from the actual delivery date.

This conflicts with the product rule that anniversary billing is based on the day the customer was actually delivered and with the existing rule that the service date is a business fact, not the moment a status button/provider call happened.

### Business consequence

Back-entered jobs or provider outages can shift billing anniversaries, term-end math, and revenue history relative to the physical delivery/credit ledger.

### Recommended fix

Persist a stable business billing anchor at the successful physical handoff, for example `firstDeliveredOn`, and carry that fact into the durable billing intent.

Keep separate concepts for:

- **service/billing anchor date** — when delivery physically occurred;
- **provider confirmation time** — when Stripe creation/update succeeded.

Use the business anchor for anniversary/fixed-term calculations; use provider timestamps only for reconciliation/operability.

### Required regression tests

- `performedOn = yesterday`, completion today → billing anchor and term end derive from yesterday.
- scheduled yesterday, no explicit `performedOn`, completion today → documented fallback is preserved.
- provider start fails/retries two days later → billing anchor does not move.
- Colorado DST boundary cases preserve the intended calendar date.

---

## P2-2 — Stripe webhook processing holds a global database transaction/lock across provider network reads

**Primary locations**

- `src/domains/billing/webhooks.ts` — `processStripeWebhookEvent`, checkout/invoice handlers

### Trigger

Any supported Stripe event arrives while Stripe API reads are slow, unavailable, or near the transaction timeout.

### Failure mode

`processStripeWebhookEvent` starts a database transaction, acquires one global PostgreSQL advisory transaction lock, and then runs the event handler:

```ts
await db.$queryRaw`SELECT pg_advisory_xact_lock(174831, 1)::text`;
return processLockedEvent(db, event);
```

Several handlers perform Stripe network reads inside that same transaction, including invoice/payment-intent retrieval and payment-detail resolution.

So a slow provider read keeps:

- a database transaction open,
- the global webhook advisory lock held,
- and every unrelated Stripe webhook waiting behind it.

The transaction timeout is 30 seconds. One provider slowdown can therefore turn into retries/timeouts across unrelated customers even though the local event idempotency logic is otherwise sound.

### Business consequence

Under provider degradation or a webhook burst, payment updates can back up globally, increase database lock duration, and cause avoidable webhook retries. This is primarily an operability/reliability issue, not a claim that the current transaction loses atomicity.

### Recommended fix

Keep the valuable local invariant—business mutation and `WebhookEvent` acknowledgment commit together—but move provider hydration outside the long-lived/global database critical section where possible.

A robust shape is:

1. verify/authenticate event;
2. fetch any provider facts needed for interpretation without holding database locks;
3. enter a short DB transaction;
4. acquire only the narrow serialization needed for the affected local identity/customer;
5. re-check idempotency/current state;
6. apply mutation + mark event processed atomically.

If global ordering is truly required for a subset of event classes, do not hold that global lock during network I/O.

### Required regression tests

- Simulated slow provider read does not hold the business-write transaction/global lock.
- Events for different customers can progress without one slow Stripe read serializing all of them.
- Two events affecting the same invoice/customer still serialize safely.
- Handler failure before local commit leaves `WebhookEvent` absent so Stripe retry remains safe.

---

# Systemic patterns / root causes

## 1. Mutable ownership is being reused as immutable provenance

`Deposit.agreementId` is useful for saying **which rental currently owns the liability**, but it is not safe as the only way to discover **which charge originally funded it** after renewals.

Likewise, `Job.agreementId` describes the agreement a visit was planned against; after renewal, it is not automatically proof that the same agreement is still the authoritative current equipment lineage.

**Recommendation:** model current ownership and immutable origin as separate facts.

## 2. Cross-domain handoffs carry identifiers but not enough business facts

`JobBillingHandoff` currently carries a kind and subject id. For starting billing, the billing domain also needs the fact that at least one appliance was physically delivered and the effective business date of that event.

**Recommendation:** durable handoffs should contain or reference the minimal immutable facts needed to re-validate the business transition after a crash/retry.

## 3. Canonical compatibility helpers exist, but local code can bypass them

The successful-payment spelling rule is already centralized, but refund code still embeds a historical spelling literal.

**Recommendation:** make money-critical status readers go through one exported predicate/filter and add a static/structural regression test that rejects new direct success-status literals outside the compatibility module/migrations/tests.

## 4. Provider recovery is strong, but provider reads and DB critical sections are still mixed

`ProviderOperation` is a strong foundation. Webhook processing should adopt the same philosophy: provider evidence can be gathered outside a transaction; only the local decision and durable application need the short locked transaction.

---

# Workflow trace matrix

| Workflow traced | Result of this pass |
|---|---|
| Lead/estimate → agreement → signing → delivery → recurring billing | New P1-3 and P2-1 |
| Partial delivery → pending item → later delivery credit | Intended 1+ delivered behavior preserved; zero-delivered edge is the defect |
| Fixed-term renewal → assignment/custody handoff → existing jobs | New P1-1 |
| Renewal → final ending → deposit return | New P1-2 |
| Invoice/deposit refund → Stripe provider operation | New P1-4 |
| Stripe webhook → local ledger → replay/recovery | New P2-2; exact-event local dedupe itself is sound |
| Early termination → quote/requote → provider term change | No new current-code defect confirmed in this pass |
| Swap → renewal happens while swap waits → completion | Current-assignment follow-through is intentionally supported; stale custody agreement provenance is covered by P1-1 |
| Customer equipment eligibility → maintenance request | Current active-equipment helper correctly requires ACTIVE agreement + physical status; no new isolation defect confirmed |
| Parts/manual payments/statement rollup | No new cross-system defect confirmed beyond the first review's existing findings |

---

# First-review reconciliation

This report does not duplicate the first review's 12 findings.

### Material change since the first baseline

PR #174 landed after the first review and substantially addresses the first report's **P1-2 historical `JobAppliance` STAFF authorization-token** problem: job-scoped staff writes now check current job state/assignment and named appliance linkage in the transactional authorization boundary. That finding is therefore not repeated here.

The other first-pass findings remain tracked by the first report; this second pass did not rescore them simply to inflate the count.

### Important dependency

The first report's provider-handoff result/claim findings remain architecturally adjacent to new **P1-3** and **P2-1**. When remediation is implemented, treat the billing handoff as one coherent reliability boundary:

- prove billing is legitimately triggered,
- preserve the real service date,
- claim work exclusively,
- and record an explicit provider outcome rather than equating a normal function return with success.

---

# False positives investigated and rejected

These were specifically checked and are **not** findings in this report:

- **Renewal start is not a simple status flip.** It locks the customer/agreement path, checks reminder/auto-renew conditions, verifies the provider term extension, pairs lines, locks moving appliances, and moves assignments transactionally.
- **Custody surviving a renewal is intentional.** Nothing physical happened when the contract term changed. The defect is stale provenance/action lineage in surviving jobs, not the fact that custody stays open.
- **True partial delivery billing is intentional.** If at least one item is actually delivered, the documented policy is to start whole-agreement billing and credit late items later. The defect is the all-negative visit.
- **The same Stripe webhook event is transactionally idempotent.** `WebhookEvent` is written in the same transaction as the local business mutation. P2-2 concerns global lock duration/network I/O, not missing same-event dedupe.
- **Known Batch D/E/F product work is not being relabeled as a defect.** Customer renewal/cancellation interaction surfaces, generalized message delivery ledger, and other planned roadmap work remain roadmap scope unless current reachable code violates an existing invariant.

---

# Recommended remediation order

1. **P1-3 — zero-delivery billing trigger**: prevents charging before any physical delivery.
2. **P1-2 — deposit payment provenance across renewals**: prevents local “refunded” state without returning Stripe cash.
3. **P1-1 — renewal/open-job lineage**: prevents physically impossible assignment/custody/billing combinations.
4. **P1-4 — canonical successful-payment status**: closes legacy-data refund and provider-identity drift.
5. **P2-1 — preserve service/billing anchor date through handoff**.
6. **P2-2 — shorten webhook transactions and remove provider I/O from the global critical section**.

When combining with the first review, fix its P1 billing-handoff outcome/claim defects **with** items 1 and 5 rather than making three independent implementations of the same boundary.

---

# Cross-cutting implementation recommendations

## A. Introduce explicit lineage/origin fields rather than reconstructing history

High-value examples:

- Deposit: immutable source receipt/payment/charge/original agreement or estimate.
- Billing start: immutable first physical delivery business date.
- Job continuation across renewal: explicit retarget/cancel audit rather than assuming the original agreement id remains authoritative.

## B. Make every durable handoff self-validating

A worker waking up after a crash should be able to ask, using durable data only:

- Is this transition still wanted?
- What business event authorized it?
- What date did that event occur?
- Has the target lineage changed?
- Has the provider already accepted it?

If those questions require assumptions about current mutable rows, the handoff is under-specified.

## C. Prefer provider identity over display-era status strings

An external charge/payment intent does not become a different payment because an old row says `SUCCEEDED` and a new row says `succeeded`.

Use the compatibility helper for business status and stable provider IDs for external identity.

## D. Use real-Postgres scenario tests for the boundaries, not only isolated functions

Highest-value new scenario tests:

1. renewal start racing/overlapping an open removal job;
2. deposit paid on A, carried through B/C, then refunded;
3. all-negative delivery completion;
4. backdated delivery + delayed provider recovery;
5. webhook provider latency while unrelated customer event arrives.

---

# Acceptance criteria for fixing this report

For each finding:

1. Define the business invariant in a focused test before or with the fix.
2. Use a real PostgreSQL integration test where the failure depends on locks, competing transitions, or durable replay.
3. Keep provider calls outside DB locks unless the design explicitly proves why they must remain inside.
4. Preserve existing approval gates: no automatic live email, production Stripe activation, spending, destructive operation, or auto-renew rollout is authorized by this review.
5. Run normal CI and reconcile any new Copilot/independent review comments against the **post-fix current head**, not against stale review prose.
6. Update the project status/acceptance ledger with merged evidence once the fixes actually land.

## Bottom line

The first review found several unsafe local commands. This second pass found the next layer: **the system can lose truth when a business fact crosses from one domain to another**.

The highest-value design improvement is to stop making downstream domains reconstruct immutable facts from mutable ownership rows. Preserve origin, lineage, and effective business date explicitly, then make every durable worker re-validate those facts before moving equipment or money.
