# Appliance Desk — Batch C design update after Batch B

Date: October 3, 2026 (America/Denver)

**Purpose:** Update the pre-Batch-B plan for Batch C. This is a stronger-model design-drift review and amendment handoff, not another review of PR #161 and not application code.

**Disposition: the old Batch C document should not authorize implementation unchanged.** The corrections below are required. The billing-dependent portions remain pending the coding agent’s promised design for the larger Batch B gaps. Independent work can be prepared separately, but each implementing slice needs an amended, explicit design first.

## 1. What the owner needs to know

Batch B added automatic renewals, reminders, scheduled renewals, and early endings after Batch C was designed. Those features change how Batch C must handle deliveries, pickups, swaps, and billing.

The main correction is to keep three facts separate: which agreement covers an appliance, where the appliance physically is, and what the customer may be charged. A renewal can change the agreement without any delivery. An agreement can end while the appliance is still waiting for pickup. A completed visit may also leave part of the work unfinished.

For planning, incorporate the quick fixes from the independent and other PR reviews as the expected baseline. Do not schedule the same repairs again in Batch C. However, the coding agent explicitly deferred overlapping billing updates, cancellation after the first renewal, and annual reminders for design. Those are dependencies, not completed fixes.

This document does not give PR #161 a merge recommendation. Its latest observed state was open, at head `f44b5e01e24527d18524f292eff84858f27c8fc5`; the owner is merging the quick fixes. Record the actual merge commit when the Batch C implementation baseline is set.

## 2. Evidence and limits

The existing Batch C design was approved on October 2 against `f272f51`, before Batch B. This review inspected documentation and relevant implementation at main `d4030e76cfd5503381f62dfb232240ddf69f311f`, plus the previously reviewed PR #161 and its review discussion. The later PR head above was checked for status; it was not fully re-audited.

Primary repository references:

- `AGENTS.md`, `docs/PLAYBOOK.md`, `docs/designs/README.md`, and `docs/designs/TEMPLATE.md`: design approval and drift procedure.
- `docs/designs/BATCH-C.md`, `docs/designs/CHANGES-SINCE-DESIGN.md`, `docs/PLAN.md`, `docs/STATUS.md`, and `docs/OWNER-INPUTS.md`: original design, changed contracts, scope, and decisions.
- `src/domains/agreements/renewal-start.ts`, `index.ts`, and `termination-execution.ts`: logical assignment transfer, ending agreements, early termination.
- `src/domains/jobs/index.ts`, `dispatch.ts`, and `checklist.ts`: job completion, scheduling, and checklists.
- `src/domains/inventory/index.ts`, `guided-actions.ts`, and `lifecycle.ts`: asset allocation, swaps, inspections, and status transitions.
- `src/domains/purchasing/index.ts`, `src/domains/maintenance/index.ts`, `src/domains/tasks/index.ts`, `src/domains/desk-access/index.ts`, and `prisma/schema.prisma`.
- Batch B billing helpers including `subscription-term.ts`, `ledger.ts`, and `collected.ts`.
- The supplied **Package-1-Independent-Audit-and-Action-Plan.md**, audited against older commit `851f319`.

The Package 1 report supplies regression requirements, not proof that its historical findings remain open. For example, the inspected maintenance transition already uses a conditional update and an audit in the same transaction. Preserve that fix; do not implement it again. No tests were run and no production operations were performed for this design update.

## 3. Revised starting assumptions

Replace the old Section 0’s blanket assumption that Batch B is finished with this checklist:

| Baseline requirement | Batch C consequence |
|---|---|
| Record the actual main and PR #161 merge SHAs before implementation. | Recheck changed files against this review; a planning assumption is not test evidence. |
| Quick review fixes are treated as incorporated for scope planning. | Preserve the email switch, reminder timing checks, explicit delivery evidence, withdrawal behavior, retry controls, and customer isolation. Verify the final implementations and tests at the pinned commit. |
| The three deferred Batch B designs are still pending. | Do not invent separate billing, cancellation, or annual-reminder mechanisms in C. |
| A scheduled renewal is not an active rental. | It does not create new physical custody or make equipment available. |
| Renewal start transfers logical assignments and the subscription pointer. | Physical custody must survive the transfer without a false pickup or delivery. |
| Early termination can close assignments and stop billing before pickup. | Pickup eligibility cannot depend only on an ACTIVE agreement or an open assignment. |
| Batch B owns receipts, credits, payment status constants, frozen terms, tax helpers, and provider-operation tracking. | New operations must use those contracts. |
| STATUS currently still tracks Batch B follow-ups. | Do not mark all of C ready merely because #161 merges. Track approved and blocked slices explicitly. |

## 4. Required amendments to the Batch C design

### C-01 — Physical custody must survive renewals and agreement endings

**Replaces the incomplete parts of C2, C4, WU-C4, and the custody backfill.**

`startRenewalInTx` closes old assignment rows and creates new ones without moving equipment. The ordinary agreement-ending path also closes assignments before physical pickup. Adding delivery and pickup timestamps only to each logical assignment, as currently proposed, is insufficient unless every transfer and historical query has explicit rules.

Design direction: represent a physical custody episode independently of the renewable agreement assignment. Link it to the appliance, customer, property, and delivery/removal evidence. Logical renewal transfers retain the same open custody episode; they do not start another one. Agreement ending leaves physical custody open until a verified return. Enforce at most one open custody episode per appliance.

The amended implementation design must supply the literal schema, relations, uniqueness enforcement, migration, and transaction signatures before coding this part. Include `startRenewalInTx`, agreement closing, scope validation, maintenance, swaps, and history readers in the change list. This is a deliberate schema amendment, not permission for the implementation agent to improvise a table.

Do not backfill a reservation timestamp as proven delivery. Use reliable completed-job evidence where available; otherwise label imported custody as estimated/unknown. Include equipment awaiting pickup on ended agreements. Ambiguous history requires reconciliation rather than a fabricated handoff.

### C-02 — Completion must record what happened to each appliance

**Amends C1, C6, WU-C4, and WU-C11.**

`PARTIAL` at the job level is not enough. The current design could move all eligible appliances even when the driver delivered only one. Require explicit per-appliance results for the confirmed job scope, persisted with the completion command. No-show performs no custody, inventory, or billing movement.

A job completion may preserve an authorized driver's report of a physical event even when system state conflicts. It must not bypass customer ownership checks, move an unrelated appliance, or assert that failed work happened. Separate recorded physical evidence from whether the automated database transition succeeded.

The existing task schema has `HIGH`, not `URGENT`; it uses `note`, not `title`, and has no appliance link field. Use a HIGH-priority task linked to the job with the asset identifier in its note/audit, unless an explicit schema amendment adds an appliance relation. Extract a transaction-capable task primitive: the present `createTask` requires a session and starts its own transaction, so it cannot provide the same-transaction guarantee required by job completion.

Completion evidence, allowed lifecycle changes, conflict tasks, audits, and a durable billing handoff must commit together. Repeating a completion must not create duplicate tasks or billing work. Do not rely solely on the current post-commit billing call and console logging.

**Billing gate:** physical facts can be designed now, but whether a partial delivery starts billing for one item or the whole agreement needs an explicit rule and the approved billing contract. Do not silently bill undelivered equipment.

### C-03 — A staged swap needs a complete reservation and recovery contract

**Amends C3 and WU-C5.**

Keep the old assignment and custody unchanged during staging. Capture the original assignment/custody identity and the reserved replacement. Lock and validate both sides so two swaps cannot be staged for the same original appliance using different replacements. The existing replacement-status claim alone only protects the replacement.

On a fully performed swap, close old custody and open replacement custody atomically; send the returned unit to `AWAITING_INSPECTION`. Remove the original design’s “MAINTENANCE or AWAITING_INSPECTION — use existing lifecycle function”: the inspected lifecycle function does not implement SWAP completion. Inspection determines the subsequent AVAILABLE or MAINTENANCE state.

Cancellation releases only the reservation owned by that swap. A partial swap records each physical result and raises reconciliation work; it must not pretend both sides occurred. Renewal starting, rental ending, and swap completion must share a documented lock order and preserve the original customer/property scope.

### C-04 — Scheduling must handle concurrent jobs and midnight boundaries

**Amends C5 and WU-C2.**

Retain optional duration, a visibly estimated 120-minute fallback, half-open intervals, and job version checks. Query all potentially overlapping intervals, including jobs that began on the preceding business day. A same-day-only query misses a long appointment crossing midnight.

A version check on one job does not prevent two different jobs being concurrently assigned to the same worker. Serialize conflict checking and writes per assignee, acquiring assignee locks in stable order when reassignment touches two people. Recompute conflicts under that lock and require confirmation for the actual conflict set; a stale blanket boolean must not authorize newly appeared conflicts.

Use Denver calendar helpers for day boundaries and explicit instants for elapsed appointment durations. Test spring-forward, fall-back, midnight overlap, touching endpoints, and simultaneous scheduling of different jobs.

### C-05 — Maintenance scheduling must be atomic and preserve Package 1 fixes

**Amends C11 and WU-C9.**

Validate request, customer, property, agreement/custody, and appliance together. Derive known property context without guessing when several properties are possible. A renewal must not make a legitimate maintenance request lose its appliance connection.

Extract a transaction-capable job-creation primitive. The inspected `createJob` opens its own transaction; calling it beside a request update does not make scheduling atomic. Job creation, request transition, linkage, and audit must commit together, retaining Package 1’s compare-and-set transition protection.

Remove the claim that job completion already resolves requests automatically. The inspected path does not do that. Define explicit resolution: a partial visit, no-show, cancelled visit, or completed visit with unresolved repair work must not mark the request resolved. Specify how follow-up visits and removal of the last scheduled visit affect the request status.

Retain atomic customer request/photo/audit creation, authorized photo references, and successful submission even when a post-commit notification fails. C must not reintroduce the Package 1 failure modes while adding property links and scheduling.

### C-06 — Asset counters must lock a real row and match the numbering namespace

**Amends C8 and WU-C7.**

Selecting a nonexistent counter `FOR UPDATE` does not lock that missing row. Create/upsert the counter safely, then lock and allocate inside the unit-creation transaction.

The counter namespace must match globally unique asset numbers. If two appliance types produce the same prefix, independent per-type counters can collide. Specify a stable prefix/namespace contract and seed against all existing numbers in that namespace. Preserve the unique asset-number constraint and all-or-nothing units plus audits.

Test concurrent first use, shared prefixes, preexisting nonstandard numbers, and audit failure rollback.

### C-07 — The parts ledger needs opening balances and retry identities

**Amends C9, WU-C1, and WU-C8.**

At migration, create a deterministic opening movement for each existing nonzero stock balance; do not both seed the balance and replay historical received purchase orders. Backfill purchase-order received quantities separately. After migration, cached quantity must equal the ledger sum.

Every writer must go through the movement primitive, including absolute stock adjustments, receipts, consumption, job usages, and corrections. Include `updatePartStockSettings`, not only `recordPartUsage`. Require a reason for corrections and transactionally persist audit plus movement plus cached balance.

Partial receipt and usage commands need durable operation identities: retrying one command must return its original result, while two genuine partial receipts remain separate. Supply uniqueness constraints and payload-consistency checks in the schema/signature amendment. Sort locks for multi-part commands.

Unknown cost is null; known zero cost is valid. Do not display a sum of only known costs as a complete repair total. Preserve an unknown-cost indicator and define how legacy manually entered parts costs coexist with itemized usage without double counting.

### C-08 — Inspection snapshots and permissions must hold at every write boundary

**Amends C7, C10, WU-C3, and WU-C6.**

Preserve the actual checklist definition with the result; a hash alone cannot reconstruct it. Submit the expected definition version, rejecting stale settings instead of evaluating an old form against new requirements. Derive pass/fail server-side, audit OWNER/ADMIN overrides, and reject STAFF overrides.

Job-scoped authority must apply inside all relevant domain mutations: completion, photos, checklists, inspection, swaps, and single/bulk/guided inventory status changes. Verify current role and account state in the write transaction. A historical completed job or a linked URL must not authorize new operational changes. Keep monetary DTO fields hidden from STAFF.

The original A10 points to a replacement-ID read helper as if it were the whole authorization boundary. Replace that assumption with an explicit inventory of domain and action checks. Preserve the existing unassigned-job policy only after verifying it; do not broaden it accidentally.

### C-09 — Add an explicit return-and-billing work unit for IN-24

**Adds the missing coverage for PLAN Batch C item 14.**

Batch B already schedules early termination and creates its fee invoice. Batch C must integrate actual returns with that machinery, not add a competing subscription-ending process or charge the fee again.

The design must distinguish agreed ending date, actual return evidence, billing cutoff, responsibility for delay, and any adjustment. A company-caused delay must not increase the customer's charge beyond the agreed ending. A waiver must reference charges that actually exist; no duplicate credit where billing already stopped. Preserve prepaid-settlement review.

All resulting provider writes depend on the pending shared billing design described below. Money mutations retain Batch B's ledger locking and receipt/credit rules. Define partial returns and pickup-day inclusivity explicitly. Customer-caused late-return pricing remains an owner decision; do not implement an assumed daily or monthly charge.

### C-10 — Correct the appliance earnings promise and preserve history

**Amends WU-C11 and WU-C12.**

`collectedBetween` reports customer/business cash. It does not attribute money to an individual appliance. Do not label a customer's total receipts as one appliance's collected earnings. Asset-specific actual earnings require a separately specified allocation method covering multi-item invoices, swaps, partial payments, credits, and refunds. Until designed, show clearly identified estimates and customer-level cash in their correct scope.

Keep completed checklists, inspection evidence, parts movements, and physical history immutable; corrections append attributable amendments. Add explicit work/test coverage for rental-line removal and historical links instead of hiding these requirements in the final audit-register cleanup. Archive suppliers/parts while retaining historic references.

## 5. Contracts required from the larger Batch B design

| Pending topic | What its design must settle | What Batch C must do |
|---|---|---|
| Overlapping billing updates | One authoritative desired billing state per subscription/rental lineage; durable intents; ordering across extend, restore, terminate, and cancel; uncertain provider outcomes; recovery after crashes; lock order. A ProviderOperation idempotency key by itself does not order distinct commands. | Submit delivery/return changes through that shared contract. Do not add direct Stripe calls or a separate cancel/extend queue. Test return versus renewal and opt-out versus delivery. |
| Cancellation after first renewal | Where consent, frozen terms, and cancellation availability live across successor agreements; what cancellation does to pending renewal and continued monthly service. | Keep custody and jobs separate from consent. Renewal/return screens must use the shared cancellation contract and preserve customer access. |
| Annual reminders | Eligibility and anniversary anchor, delivery evidence, missed-window behavior, retry/uncertainty handling, and interaction with cancellation and held billing. | Do not reset the anniversary on swap, maintenance, or logical agreement transfer; do not build another reminder scheduler. |

These are engineering acceptance requirements, not a legal determination. The applicability and exact wording/timing of ongoing reminders and cancellation disclosures remain for legal review; this update does not certify Colorado compliance.

Carry forward the independent review's durable cancellation recovery, stale-message prevention, uncertain-delivery handling, and fair retry scheduling. Carry forward other PR review findings, including rejecting an empty manually supplied delivery date and respecting the customer's current consent before extending billing. Treat quick repairs as baseline scope assumptions; verify their final disposition rather than claiming every finding was implemented.

## 6. Implementation order and approval boundaries

1. **Record the merged baseline and review disposition.** Link each PR finding to a quick fix or the deferred design. Record actual tests and outstanding failures, including the rebuilt test database's migration status.
2. **Amend C's self-contained work.** Asset numbering, parts ledger/archival, and scheduling can be separately designed and approved without waiting for annual-reminder implementation. Supply literal schema, exact signatures, migration/backfill order, and tests as required by the repository template.
3. **Finish the shared B contract design and C custody/completion design together.** Include renewal and termination call sites, per-appliance evidence, atomic task creation, and durable side-effect handoff.
4. **Resolve the money decisions and approve return settlement.** Do not automate an undecided charge or partial-delivery billing rule.
5. **Implement approved slices and verify cross-batch behavior.** Annual-reminder work need not prevent unrelated inventory work, but unresolved renewal obligations remain an explicit release gate for the affected automatic-renewal flow.

Do not mark the entire Batch C design approved while Sections C-01/C-02/C-09 or the shared billing contract still lack implementation-ready definitions. This is the design gate required by AGENTS, PLAYBOOK, and the design template, not a request for another generic code audit.

## 7. Required acceptance evidence

Use real Postgres for concurrency/rollback cases and a mocked provider for failure ordering. These are proposed tests, not tests run by this review.

| Scenario | Required result |
|---|---|
| Delivered appliance renews twice without moving | One continuous physical custody episode; logical agreement history remains accurate. |
| Early-ended agreement awaits pickup | Appliance remains unavailable and eligible for authorized pickup; no dependency on ACTIVE agreement status. |
| One of three appliances actually delivered | Evidence and movement match that one appliance; no automatic full-agreement billing by assumption. |
| Completion retried after client timeout | One completion, one set of tasks/audits, one durable billing intent. |
| Crash after completion commit, before provider call | Billing work remains discoverable and retryable. |
| Renewal extension overlaps return/termination | Provider state converges to the latest authorized desired state; stale work cannot leave billing extended. |
| Two staged swaps for one original or one replacement | At most one compatible reservation succeeds; cancellation cannot release another operation's reservation. |
| Renewal starts while maintenance/swap is processed | Customer/property custody stays consistent; no false delivery or loss of scope. |
| Two jobs concurrently assigned to one worker | Conflict handling is serialized and the actual conflict requires confirmation. |
| Midnight, March/November DST, month-end | Correct Denver boundaries; no 24-hour approximation of calendar days. |
| First counter use occurs simultaneously | Unique asset numbers; no partial batch after failure. |
| Opening stock, duplicate receipt, concurrent usage | Ledger equals cached stock; no double receipt or negative stock from clamping. |
| Maintenance schedule or audit fails midway | Neither partial job linkage nor partial request state persists. |
| Partial/no-show maintenance visit | Request remains unresolved with clear follow-up work. |
| Foreign customer IDs, stale STAFF job, archived actor | Mutation denied at the domain boundary; no money-field leak. |
| Inspection settings change while form is open | Stale submission rejected; original definition remains reconstructable. |
| Email rejection or uncertain acceptance | No false delivery evidence or loss of the underlying committed business action. |

Retain Package 1 isolation, photo authorization, bounded portal reads, stable pagination, and atomic audit guarantees. Register settings-writing tests and browser shards as the repository requires. A reset test database must be migrated and seeded reproducibly; its rebuild alone is not evidence of correctness.

## 8. Questions that genuinely need the owner

1. **If a customer causes a late return, should the extra charge be by day or by month?** This is already left open under IN-24. Company-caused delay must remain waived.
2. **If only part of an order is delivered, should billing begin for the delivered items or wait until the full order is delivered?** The current C design does not settle this.
3. **Does the pickup day count as a billable day?** Specify this for actual-return settlement; the inspected early-ending code currently treats the effective ending date as the first non-billable day.

These questions gate the affected money rules, not asset numbering, stock corrections, or scheduling design. Do not reopen settled owner choices such as company-delay waivers or fixed terms starting with delivery.

## 9. Documentation handoff for the coding agent

Apply this as a dated amendment, preserving the previous design history:

- `docs/designs/BATCH-C.md`: add the drift review at the top; amend C1–C11 and work units; add the IN-24 unit; replace incomplete schema/signatures; distinguish approved slices from blocked ones.
- `docs/designs/README.md`: change the blanket approval label to match the actual amendment/approval state.
- `docs/designs/CHANGES-SINCE-DESIGN.md`: record renewal-safe physical custody, the shared billing dependency, notice/consent requirements, and effects on later customer/reporting designs.
- `docs/PLAN.md`: map item 14 explicitly; correct the claim that no owner inputs remain; clarify that purchasing UI improvements do not eliminate the ledger migration.
- `docs/STATUS.md`: record actual merge/test evidence and pending design gates. Do not mark C complete or wholly ready from this review.
- `docs/OWNER-INPUTS.md`: retain the open late-return question and record the answers on partial delivery and pickup-day counting when supplied.
- `docs/BUSINESS-RULES.md` and `docs/DECISIONS.md`: update only after the corresponding design/owner decision is finalized; retain traceability to IN-19–IN-25.
- `docs/GO-LIVE-CHECKLIST.md`: keep unresolved automatic-renewal billing/cancellation/reminder obligations visible until implemented and verified.

**Next stronger-model handoff:** provide the promised deferred-B design, final #161 merge SHA/review disposition, and this amendment together. The remaining review should finalize the shared contracts and literal C implementation specification, not repeat the already completed review of quick fixes.
