# Appliance Desk — Current Codebase Review

**Review date:** 2026-10-03 (America/Denver)  
**Repository:** `christcr2012/appliance-desk`  
**Reviewed baseline:** `main` at `196b73606a409bc5d1f75d9b3fd38e856db04e18`  
**Review standard:** `.github/skills/code-review/SKILL.md`  
**Review type:** Risk-driven current-code review, with recent GitHub review reconciliation

---

## Executive summary

The current codebase is materially stronger than the older audit baseline. Recent work has added real transaction boundaries, row locks, optimistic concurrency, durable provider-operation records, a serialized customer ledger, custody invariants, private media controls, guarded staff mutations, parts-ledger idempotency, and real-Postgres race coverage in several high-risk areas.

This review intentionally does **not** re-report an older audit or PR comment merely because it still exists in GitHub history. Every scored finding below was checked against the current `main` commit listed above.

I found **12 current actionable findings**:

| Severity | Count |
| --- | ---: |
| P0 | 0 |
| P1 | 3 |
| P2 | 9 |
| **Total** | **12** |

The highest-priority current problems are:

1. a job-completion billing handoff can be marked `DONE` even when the underlying Stripe operation ended `FAILED`, `UNKNOWN`, blocked, or deferred;
2. a historical `JobAppliance` relationship still acts as durable STAFF authorization for broad appliance-status mutations;
3. an estimate can still be approved or changed after its displayed `validUntil` date.

The strongest cross-cutting recommendation is to keep converging on the patterns that are already working well elsewhere in the repository:

- **guarded transactional commands**: actor check + row lock/current-state validation + business mutation + audit in one transaction;
- **explicit outcome contracts for external work**: callers must distinguish confirmed success, definitely failed, unknown, blocked, already in progress, and terminal no-op;
- **durable operation identity** for all retryable work;
- **Colorado business-date helpers** for date-only business inputs;
- **bounded/paginated operational queries** rather than full-table aggregation in request paths.

---

# Review scope and method

The review followed `.github/skills/code-review/SKILL.md` and expanded around the areas where a defect would have the highest business impact:

- authentication, roles, active-actor enforcement and STAFF provenance;
- job completion, custody and appliance lifecycle transitions;
- Stripe/provider operations, billing-start handoffs and customer credits;
- estimates and customer-visible state;
- money parsing and repair-cost data;
- purchasing, parts inventory, idempotency and concurrent stock changes;
- exception/TODAY operational queries;
- date-only business values and Denver time semantics;
- recent PR review threads, checked against current code rather than accepted at face value.

I also checked relevant repository rules and current project-control documentation, especially `AGENTS.md`, `docs/STATUS.md`, `docs/AUDIT_SYNTHESIS.md`, and the current Batch C implementation/design material.

### Review limitation

This was a source-level review through the connected GitHub repository. I did **not** execute the full test suite or a real-Postgres race suite in this review session. Every finding therefore includes the focused regression evidence I recommend adding before considering it closed.

---

# P1 findings

## P1-1 — Job billing handoffs can record `DONE` when the provider operation did not succeed

**Primary locations**

- `src/domains/jobs/completion.ts` — `runHandoffs`
- `src/domains/billing/checkout.ts` — `startRecurringBillingForAgreement`
- `src/domains/billing/pickup-billing-events.ts` — `pushLateDeliveryCreditToStripe`
- `src/domains/billing/provider-ops.ts`

### Trigger

A completed job creates a `JobBillingHandoff` for either:

- starting recurring Stripe billing; or
- pushing a late-delivery/customer balance credit to Stripe.

The handoff runner calls the underlying operation and treats a normal function return as success.

### Failure

Both underlying provider functions intentionally handle several non-success outcomes without throwing.

`startRecurringBillingForAgreement()` can:

- catch `RetryLater`, set a billing blocker, and return;
- record Stripe `FAILED` or `UNKNOWN`, set a blocker, and return;
- fail during subscription preparation, record the failure, and return.

`pushLateDeliveryCreditToStripe()` can:

- return on `RetryLater`;
- persist `FAILED`/`UNKNOWN` provider-operation state and return without applying the credit.

`runHandoffs()` then unconditionally marks the handoff `DONE` because no exception escaped.

### Consequence

The durable handoff can say the post-completion billing work is finished while the actual Stripe state is unresolved.

That can suppress the retry path the handoff exists to guarantee, including:

- an agreement delivered without a confirmed recurring subscription; or
- a customer credit created locally but never confirmed in Stripe.

This is a revenue and customer-balance correctness issue, not merely a logging mismatch.

### Recommended fix

Give the provider-facing commands an explicit result contract, for example:

```ts
type ProviderWorkResult =
  | { status: "DONE" }
  | { status: "RETRY"; reason: string }
  | { status: "BLOCKED"; reason: string }
  | { status: "UNKNOWN"; reason: string };
```

Then make `runHandoffs()` mark `DONE` **only** for an authoritative terminal-success/no-op result. `RETRY`, `FAILED`, `UNKNOWN`, or provider-in-progress states must remain retryable/reconcilable and visible.

Do not infer provider success from “the function did not throw.”

### Required regression evidence

Add real behavior tests proving:

1. Stripe subscription `FAILED` does not mark the handoff `DONE`;
2. Stripe subscription `UNKNOWN` does not mark it `DONE`;
3. `RetryLater` does not mark it `DONE`;
4. a failed late-delivery balance credit remains retryable;
5. confirmed provider success marks the handoff `DONE` exactly once;
6. reconciliation of an earlier unknown provider operation can subsequently finish the handoff.

---

## P1-2 — Historical `JobAppliance` rows remain permanent STAFF authorization tokens

**Primary locations**

- `src/app/desk/jobs/actions.ts` — `updateApplianceStatusFromJobAction`
- `src/domains/inventory/guarded-status.ts` — `updateApplianceStatusAsTeamActor`
- `src/domains/inventory/lifecycle.ts` — `ALLOWED_APPLIANCE_TRANSITIONS`

### Trigger

A STAFF user calls `updateApplianceStatusFromJobAction(applianceId, status, jobId)` using a job that once contained that appliance.

### Failure

For STAFF, the additional authorization check is effectively:

```text
jobId exists
AND JobAppliance exists for (jobId, applianceId)
```

Once that historical relationship is found, the requested status is passed into the general appliance lifecycle transition rules.

The server does **not** establish that:

- the job is still current operational work;
- the job is in a state where a follow-up mutation is allowed;
- the target status is the one justified by that job type;
- the appliance is the correct side/role of a directional workflow such as a swap;
- the historical relationship should still grant authority at all.

`JobAppliance` is durable history, while the general lifecycle table intentionally includes broad owner/admin inventory transitions.

### Consequence

A STAFF user can reuse an old valid `(jobId, applianceId)` pair later as provenance for a new status change unrelated to the original work, provided the requested transition is globally legal.

That makes authorization broader and longer-lived than the operational job that was supposed to justify it.

### Recommended fix

Separate **OWNER/ADMIN manual inventory authority** from **STAFF job-derived authority**.

For STAFF:

1. load the current job and `JobAppliance` row server-side;
2. verify the job is in the exact state/window where follow-up is permitted;
3. verify `JobAppliance.role`/workflow intent where direction matters;
4. derive the allowed target status from job type + role + current state;
5. reject an arbitrary client-supplied target even when the global owner lifecycle would permit it;
6. make completed/historical work cease to be a general authorization source once its allowed follow-up is complete.

### Required regression evidence

Add adversarial tests proving:

- a historical completed job cannot be reused later as general appliance authority;
- a globally valid but job-unrelated target is rejected for STAFF;
- swap replacement/outgoing roles cannot be exchanged;
- DELIVERY/INSTALLATION/REMOVAL only permit their intended follow-up effects;
- OWNER/ADMIN retain the intended broader manual inventory path.

---

## P1-3 — Expired estimates are still customer-approvable and change-requestable

**Primary locations**

- `src/domains/estimates/index.ts` — `approveEstimate`
- `src/domains/estimates/index.ts` — `requestEstimateChanges`
- `src/domains/estimates/index.ts` — `getEstimateForApproval`
- `src/app/estimate/[id]/page.tsx`
- `prisma/schema.prisma` — `EstimateStatus.EXPIRED`, `Estimate.validUntil`

### Trigger

An owner creates an estimate with a visible `validUntil` date. The customer opens or reopens the link after that date and submits approval or a change request.

### Failure

The current response paths lock the estimate correctly for concurrency, but eligibility is based on status (`SENT`/`VIEWED`) rather than the validity deadline.

`validUntil` is displayed to the customer, and the schema already has `EXPIRED`, but the locked approval/change-request commands do not enforce that date.

### Consequence

A customer can accept pricing/terms after the system has told them the quote is no longer valid.

That can bind the business workflow to stale pricing, fees, inventory assumptions, or terms and create avoidable billing/customer disputes.

### Recommended fix

Enforce expiration **inside the same row-locked transaction** used by approval/change requests.

Recommended behavior:

1. define the business meaning of `validUntil` as a Colorado date;
2. if the deadline is past, atomically transition an awaiting-response estimate to `EXPIRED` (where appropriate);
3. reject approval/change requests after expiration;
4. have the public page render a clear expired state rather than an actionable approval form.

Do not perform an unlocked pre-check that can race with the response transaction.

### Required regression evidence

Cover:

- approval before the valid-through boundary succeeds;
- approval after it fails and does not convert a lead/customer;
- change request after expiry fails;
- public read after expiry does not expose active response controls;
- Denver/DST boundary behavior is deterministic.

---

# P2 findings

## P2-1 — A claimed job billing handoff remains claimable while provider work is in flight

**Primary location**

- `src/domains/jobs/completion.ts` — `runHandoffs`

### Trigger

Two handoff sweeps overlap. Worker A increments `attempts` and begins the provider call before it has updated the handoff status.

### Failure

The “claim” only increments `attempts`. The row remains `PENDING` or `FAILED`, which is exactly the state queried by another sweep.

Worker B can read the new attempt count and claim the same row again while A is still executing.

The underlying provider-operation layer is largely idempotent, which reduces the chance of duplicate Stripe side effects, but the handoff scheduler itself has no non-claimable in-flight state or lease token.

### Consequence

Overlapping workers can:

- consume multiple retry attempts for one logical attempt;
- perform duplicate local/provider orchestration;
- race final status writes;
- make troubleshooting attempt counts misleading;
- reach the retry ceiling faster than intended.

### Recommended fix

Atomically claim a handoff into a non-claimable state, for example:

```text
PENDING/FAILED -> IN_FLIGHT
```

Store a `claimToken`/`claimedAt` (or equivalent lease), and require that same claim identity when writing the final result. Define stale-claim recovery separately.

### Required regression evidence

A real-Postgres concurrency test should pause worker A after the claim, start worker B, and prove only one worker owns the row/provider attempt.

---

## P2-2 — Several inventory mutation commands do not use the repository’s guarded transactional command pattern

**Primary locations**

- `src/domains/inventory/index.ts`
  - `createApplianceUnits`
  - `updateApplianceDetails`
  - `updateApplianceStatus`
  - `addAppliancePhoto`
- `src/domains/inventory/guided-actions.ts`
  - `startRepairForAppliance`
  - `retireAppliance`
  - `recordApplianceInspection`
- comparison helper: `src/lib/team-actor.ts` — `assertActiveTeamActor`

### Trigger

An inventory write is already in flight after the request-level role check, or a later audit write fails.

### Failure

The repository now has a deliberate `assertActiveTeamActor(tx, ...)` contract that re-checks identity inside the same transaction as the business mutation. Several inventory commands do not consistently use it.

There is also inconsistent business-state/audit atomicity. Most notably, `updateApplianceDetails()` writes the appliance and then writes its audit record outside a shared transaction, and `addAppliancePhoto()` follows the same split pattern.

### Consequence

The inventory subsystem does not have one reliable invariant that says:

```text
active authorized actor + business write + audit evidence commit together
```

That weakens offboarding/authorization guarantees compared with newer domains and permits a committed inventory change to exist without its intended audit record if a later write fails.

### Recommended fix

Refactor inventory mutations to one command pattern:

1. begin transaction;
2. `assertActiveTeamActor(tx, userId, allowedRoles)`;
3. lock/read current business state as needed;
4. apply CAS/lifecycle/custody checks;
5. write the business mutation;
6. write immutable audit evidence;
7. commit together.

Preserve existing optimistic-concurrency behavior for appliance details/status; do not replace it with last-write-wins.

### Required regression evidence

Add tests that prove:

- business mutation rolls back if audit creation fails;
- actor invalidation is re-checked inside the mutation transaction;
- stale appliance detail/status edits still fail rather than overwrite newer data.

---

## P2-3 — Date-only form values bypass the canonical Colorado business-date helpers

**Primary locations**

- `src/app/desk/inventory/actions.ts` — `purchaseDate`
- `src/app/desk/estimates/actions.ts` — `validUntil`
- `src/app/estimate/[id]/page.tsx`
- canonical helper: `src/lib/business-date.ts`

### Trigger

A user submits an HTML date-only value such as `2026-10-03`.

### Failure

Some actions convert date-only strings using:

```ts
new Date("YYYY-MM-DD")
```

JavaScript interprets that form as UTC midnight, not Colorado midnight/date semantics. The repository already has `businessDateFromKey`, `businessDateEnd`, `businessDateKey`, and Colorado formatters specifically to avoid server/runtime timezone drift.

### Consequence

The stored instant can represent the previous Colorado calendar date. Depending on the later formatter/comparison path, a date can display or behave one day off, especially when a business rule is supposed to mean “through this Colorado date.”

### Recommended fix

For date-only business inputs:

- validate strict `YYYY-MM-DD`;
- use `businessDateFromKey()` when the meaning is the start of that business date;
- use `businessDateEnd()` when the meaning is “valid through” the date;
- render with the repository’s business-date formatter rather than runtime-local `toLocaleDateString()`.

### Required regression evidence

Test winter/summer dates and DST transition weeks with an explicit America/Denver expectation.

---

## P2-4 — Repair-cost inputs accept negative money and silently turn malformed values into `null`

**Primary locations**

- `src/app/desk/jobs/actions.ts` — `repairCostSchema`, `dollarsToCentsOrNull`
- `src/domains/jobs/index.ts` — `setJobRepairCosts`

### Trigger

An owner/admin submits a repair cost such as:

- `-25`;
- `abc`;
- a value with excessive fractional precision.

### Failure

The action schema accepts arbitrary strings. `dollarsToCentsOrNull()`:

- accepts negative finite numbers and rounds them into negative cents;
- returns `null` for malformed non-numeric input instead of returning validation failure;
- rounds arbitrary fractional precision.

The domain function then persists the cents/null values without a defensive non-negative money invariant.

### Consequence

A typo can silently clear a repair cost, and a negative repair cost can understate expenses and inflate fleet/appliance profitability.

### Recommended fix

Use one strict money parser for editable dollar fields:

- blank -> `null` only when blank is intentionally allowed;
- non-numeric -> validation error;
- negative -> validation error;
- more than two decimal places -> reject or apply one documented canonical policy;
- enforce an upper bound;
- convert to integer cents only after validation.

Also validate `number | null` again in `setJobRepairCosts()` so direct domain callers cannot bypass the action parser.

### Required regression evidence

Prove `-1`, `abc`, and `1.001` are rejected; `123.45` stores `12345`; blank intentionally stores `null`; direct negative-cents domain calls fail.

---

## P2-5 — Initial estimate sending is not atomically claimed and can send duplicate customer emails

**Primary location**

- `src/domains/estimates/index.ts` — `sendEstimate`

### Trigger

Two tabs/requests submit “Send to customer” for the same editable estimate at nearly the same time, or a client retries before receiving the first response.

### Failure

Both callers can read the same editable status before either commits. The later transaction uses an unconditional `estimate.update({ where: { id } ... })`, not a compare-and-set on the expected status.

After each transaction, each caller invokes customer email independently, and the initial send does not supply a deterministic provider idempotency key.

### Consequence

One logical send can produce multiple customer emails and multiple apparent send actions.

Client-side button disabling does not protect separate tabs, retries, or overlapping server requests.

### Recommended fix

Atomically claim the send from the editable state before provider contact.

Prefer the same durable-message pattern the repository is moving toward elsewhere:

1. claim the estimate/send attempt exactly once;
2. persist a deterministic operation identity;
3. send with provider idempotency identity;
4. distinguish disabled / rejected / unknown / accepted outcomes;
5. reconcile unknown outcomes instead of replaying blindly.

If `SENT` intentionally means “owner made this estimate shareable even though customer email is disabled,” preserve that product meaning, but still make the transition single-winner.

### Required regression evidence

Run two concurrent send attempts and prove one logical send/provider call wins. Add retry tests for accepted, rejected, disabled, and unknown outcomes.

---

## P2-6 — The Today/exception inbox executes broad unbounded operational queries

**Primary location**

- `src/domains/exceptions/index.ts` — `getExceptions`

### Trigger

The business accumulates a large history of agreements, invoices, jobs, maintenance requests, appliances, pending deliveries, notices, and maintenance visits.

### Failure

`getExceptions()` performs many independent `findMany` queries without a result bound/cursor and then materializes/sorts the combined result in application memory.

The rented-appliance query also loads completed maintenance-job history per rented appliance and then sorts those dates in JavaScript to identify the latest maintenance event.

### Consequence

The owner’s primary “Needs your attention” workflow gets slower as historical data grows and can eventually become a request-time memory/latency hotspot.

A dashboard intended to surface the most urgent work should not require loading an effectively unlimited historical working set.

### Recommended fix

Design the exception inbox as a bounded feed:

- page/cursor the final result;
- fetch only enough rows per category to satisfy the requested page/window;
- query the latest relevant maintenance event in SQL (`orderBy/take`, aggregate, lateral/subquery, or maintained summary) instead of loading every completed visit;
- return category counts separately when the UI needs totals.

### Required regression evidence

Add a large-fixture test that proves the API/query layer is bounded and deterministic, plus query-shape coverage for “latest maintenance” rather than all maintenance history.

---

## P2-7 — Purchase-order creation validates the supplier outside the transaction and writes audit after commit

**Primary location**

- `src/domains/purchasing/index.ts` — `createPurchaseOrder`

### Trigger

A supplier is archived concurrently with creation of a new purchase order, or the audit write fails after the order transaction commits.

### Failure

The current sequence is:

1. read supplier/`archivedAt` outside the transaction;
2. start transaction;
3. lock/check parts;
4. create purchase order;
5. commit;
6. create audit log in a separate operation.

The supplier is not locked/re-checked in the transaction that creates the order, and the audit row does not share the order transaction.

### Consequence

A race can create a new order for a supplier that was archived between steps 1 and 4. Separately, an order can commit without the intended immutable audit evidence.

### Recommended fix

Make creation one guarded transaction:

1. `assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"])`;
2. lock supplier row and re-check `archivedAt`;
3. lock/re-check linked part rows in canonical order;
4. create order + lines;
5. create audit row;
6. commit.

### Required regression evidence

Use real Postgres to race supplier archival against order creation and prove both cannot win in the invalid ordering. Also prove audit failure rolls the order back.

---

## P2-8 — Part usage can permanently record a stale purchase cost during a concurrent receipt

**Primary locations**

- `src/domains/purchasing/index.ts` — `recordPartUsage`
- `src/domains/purchasing/ledger.ts` — `lastKnownPurchaseCostCents`, `applyPartMovementsInTx`, `lockPartRecords`

### Trigger

A receipt for a part and a usage of the same part overlap.

### Failure

`recordPartUsage()` reads `lastKnownPurchaseCostCents()` **before** `applyPartMovementsInTx()` acquires the part-row lock.

A concurrent receipt can already hold that lock but remain uncommitted. The usage transaction reads the previous/unknown cost, then waits for the receipt’s lock, and finally consumes from the newly updated stock while persisting the stale cost it read earlier.

### Consequence

The stock quantity can be correct while job/fleet repair cost history is permanently understated or otherwise wrong.

That is especially difficult to repair later because the usage movement is the durable historical cost evidence.

### Recommended fix

Acquire the part lock **before** resolving the last known purchase cost and keep it through the usage movement.

A clean shape would be a ledger helper that:

1. locks the part;
2. checks replay identity;
3. resolves current cost under the lock;
4. writes usage + balance atomically.

### Required regression evidence

A real-Postgres race test should pause a priced receipt while holding the part lock, start usage, then release the receipt and prove usage records the newly committed receipt price rather than the prior/null price.

---

## P2-9 — Free-text purchase-order receipt retries do not verify the complete original payload

**Primary location**

- `src/domains/purchasing/index.ts` — `receivePurchaseOrderLines`, `replayLineMovements`

### Trigger

A purchase order contains a free-text line with no `partRecordId`. A receipt succeeds under operation key `K`, the response is lost, and a retry reuses `K` with a different quantity or price payload.

### Failure

Replay detection can find the prior `purchase_order.receive` audit row, but payload verification is delegated to `replayLineMovements()`.

That helper skips lines with no `partRecordId`, because there is no stock movement to replay. For a free-text-only receipt, the changed retry payload can therefore return `replayed: true` without being compared with the original submitted receipt.

### Consequence

The API reports a successful idempotent replay even though the caller supplied a different operation. The operator can believe the edited quantity/price was recorded when the database still contains the first receipt.

### Recommended fix

Make receipt idempotency belong to a durable **receipt operation**, not merely to its optional stock movements.

Persist a canonical hash of the full receipt payload, including:

- every line ID;
- received quantity;
- entered/unknown unit cost;
- purchase-order identity.

On retry:

- same key + same complete hash -> replay first result;
- same key + different hash -> `PartOperationConflictError` (or equivalent).

### Required regression evidence

Cover both free-text-only and mixed receipts:

- identical retry -> `replayed: true`, no extra quantity;
- same key + changed free-text quantity -> conflict;
- same key + changed free-text price -> conflict;
- a new operation key is required for a genuine second partial delivery.

---

# Review-feedback reconciliation

Recent GitHub review threads were treated as leads, not as automatically valid findings. Several previously reported issues are already fixed in the current code and were deliberately **not** rescored above.

Examples verified as fixed/currently addressed include:

- appliance custody guards now lock the appliance row before validating conflicting status/custody changes;
- guided retirement/inspection paths now invoke custody protection;
- guided swaps persist the replacement role and complete physical custody at completion rather than merely at staging;
- current job completion validates delivery/return scope against agreement/customer custody context;
- archived part records are checked during new purchase-order creation;
- part stock-settings replay now locks the part and compares both quantity and reorder threshold;
- purchase-order receipt movements can no longer be reversed through the generic reversal path while leaving PO receipt state inconsistent;
- parts-ledger movement timestamps are explicitly stamped after the serialized lock so order reflects application order more reliably;
- supplier purchase-order history now labels unknown costs as unpriced instead of presenting them as definite zero-cost totals.

This distinction matters: unresolved review-thread status in GitHub is **not** proof that the current code still has the defect.

---

# Already-documented roadmap/design gaps not rescored as new review findings

The current project-control documents already call out work that is intentionally unfinished or gated. I did not inflate the finding count by presenting those as newly discovered defects.

Examples include the documented Batch B/D/E/F follow-ups around:

- remaining renewal lifecycle design gaps;
- customer cancellation/renewal screens;
- annual reminder behavior;
- provider message IDs/evidence;
- estimate follow-up claim-before-send;
- owner-controlled go-live switches and unresolved owner policy inputs;
- later control-plane/privacy/communications/reporting work.

Those should remain in the planned batches unless a current defect makes them a prerequisite.

---

# Additional repository-control observation

## `docs/STATUS.md` is behind the current `main` head

At the reviewed commit, `main` includes PR #173, but the current status table still describes #173/slice 5 as open and lists the Batch C stack only through #172.

This is not scored as a code defect, but it is worth correcting because repository instructions treat `docs/STATUS.md` as the short current-state handoff. Stale status text increases the chance that a future coding agent rebuilds already-merged work or follows the wrong next slice.

**Recommendation:** update `docs/STATUS.md` as part of the next normal documentation/status commit; do not change historical audit documents merely to make them look current.

---

# Recommended remediation order

## 1. Fix before relying on the affected workflows

1. **P1-1** — provider handoff false-success semantics.
2. **P1-2** — historical STAFF job provenance as permanent authority.
3. **P1-3** — enforce estimate expiration.

These have the clearest direct impact on money, authorization, or a customer-visible contractual promise.

## 2. Close concurrency/idempotency integrity gaps

4. **P2-1** — non-exclusive handoff claim.
5. **P2-5** — initial estimate send claim/idempotency.
6. **P2-7** — purchase-order supplier/order/audit transaction.
7. **P2-8** — lock part before deriving usage cost.
8. **P2-9** — full receipt-operation payload identity.

## 3. Normalize data/input/query contracts

9. **P2-2** — inventory guarded transaction/audit pattern.
10. **P2-3** — canonical Denver date-only parsing.
11. **P2-4** — strict repair-cost money validation.
12. **P2-6** — bounded exception-inbox queries.

---

# Cross-cutting recommendations

### A. Make external-operation outcomes impossible to misinterpret

Provider-facing functions should not use `void`/normal return to represent both “success” and “failure was handled locally.” Return a discriminated status. The caller should be forced by TypeScript to handle `SUCCEEDED`, `FAILED`, `UNKNOWN`, `BLOCKED`, `IN_PROGRESS`, and terminal no-op cases deliberately.

### B. Standardize one guarded command skeleton

The best newer code already follows this model:

```text
start transaction
  -> lock/re-check active actor
  -> lock current business record(s) in canonical order
  -> validate current state/version/ownership
  -> mutate business state
  -> write immutable audit evidence
commit
external side effect only after durable local intent exists
```

Promote that pattern into review expectations for inventory and purchasing as well as billing/jobs.

### C. Treat operation identity as its own business record when a workflow has no natural stock/provider row

A retry key should identify the **whole logical request**, including no-op and free-text cases. Do not make idempotency depend on whether the operation happened to create another row.

### D. Centralize date-only and money parsing

Two classes of bugs become much harder to introduce if actions cannot directly call `new Date(dateInput)` or ad-hoc `Number(raw) * 100` for business data.

Prefer reusable helpers with explicit semantics:

- `parseBusinessDateKey` / `businessDateFromKey` / `businessDateEnd`;
- strict optional-dollar -> integer-cents parser.

### E. Keep concurrency tests at the domain boundary where the race is real

For race-sensitive fixes, a mocked unit test is not enough. Preserve the repository’s newer practice of real-Postgres tests that intentionally pause one transaction while a competitor runs.

The highest-value new race tests from this review are:

- handoff worker vs handoff worker;
- supplier archive vs purchase-order create;
- part receipt vs part usage;
- estimate send vs estimate send.

---

# Positive findings / architecture worth preserving

The following current patterns are strong and should be reused rather than replaced:

- `assertActiveTeamActor()` explicitly serializes active-account validation with deactivation;
- the customer ledger/manual-payment path now uses a durable receipt/allocation model and customer-level serialization;
- provider-operation records and deterministic Stripe idempotency keys create a solid base for reconciliation;
- appliance status/custody paths now have much stronger row-lock and physical-custody invariants than the earlier audit baseline;
- job completion uses per-appliance results rather than assuming whole-job success;
- parts inventory now has an append-only movement ledger and prevents silent negative stock;
- optimistic concurrency exists on important records instead of silently overwriting stale edits;
- branch rules require CI/preview/review gates, which is appropriate for the size and business sensitivity of the codebase.

The recommendations above are primarily about finishing the migration to those good patterns consistently across the remaining older or newly-added paths.

---

# Suggested acceptance criteria for closing this review

Do not close an item solely because code changed. For each scored finding:

1. implement the minimal invariant-preserving fix;
2. add the focused regression test named in the finding;
3. use real Postgres for the concurrency findings;
4. run the normal CI suite;
5. reconcile any new Copilot/independent review comments against the **post-fix current code**;
6. update the project status/acceptance ledger with the actual merged evidence.

No finding in this document requires bypassing the existing approval gates for live email, automatic renewals, production Stripe behavior, spending, destructive data operations, or deployment.