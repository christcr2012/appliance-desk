# Prompt for a stronger model: write the literal Batch C specification

Copy everything below the line into a new chat with a heavy-reasoning model that can read the repository
`christcr2012/appliance-desk` (branch `main`, which includes Batch B through PR #161, merge `b72f05d`).
Ask it to **write design text only, not application code**. The owner (Chris Robinson) is not a developer: end with a
plain-English summary and the questions only he can answer.

Why this prompt exists (2026-10-03): the stronger-model update `docs/designs/BATCH-C-UPDATE-2026-10-03.md` corrected the
old Batch C design but says, in section 4 and section 6, that the literal schema, relations, uniqueness rules, migration
order, function signatures and tests still have to be supplied "before coding". Chris confirmed on 2026-10-03 that the
update was the whole review so far and that nothing newer exists. Until this specification exists, **no Batch C slice is
approved for code**. The coding agent may not invent any of it (AGENTS.md: "Implement only from an approved design").

---

Read `AGENTS.md`, `docs/designs/README.md`, `docs/designs/TEMPLATE.md`, `docs/designs/BATCH-C.md` (the 2026-10-03
amendment and drift check at its top, then sections 1 to 5), `docs/designs/BATCH-C-UPDATE-2026-10-03.md` (binding where it
disagrees with the old text), `docs/designs/CHANGES-SINCE-DESIGN.md`, `docs/PLAN.md` (Batch C), `docs/OWNER-INPUTS.md`
(IN-24, IN-26, IN-27), and `docs/prompts/DESIGN-IN-24-PICKUP-BILLING.md` and
`docs/archive/prompts/DESIGN-BATCH-B-RENEWAL-LIFECYCLE.md` (the two billing designs this work must plug into). Where that
renewal prompt says to read `docs/DECISIONS.md`, do not read it end to end: search it for IN-19 through IN-27, "pickup"
and "renewal", and open only those entries (AGENTS.md's reading rule). Note that the pickup/return billing rules
themselves (IN-24 customer-caused part, IN-26, IN-27) are already built — see `docs/ARCHITECTURE.md`
"Pickup and return billing" and `docs/designs/CHANGES-SINCE-DESIGN.md` — so the design must build on them, not redo them.

## What to produce

A dated amendment to `docs/designs/BATCH-C.md` written to the `TEMPLATE.md` standard: decisions already made (with one or
two sentences of reasoning), schema as literal Prisma text, raw SQL for partial indexes, backfills **and the order they
run in**, literal TypeScript signatures, lock order, named tests (real Postgres for every concurrency or rollback case),
and a stop-and-ask list. Every file and line you cite must exist at the commit you read. Decide; do not write "consider"
or "either/or". Do not edit Batch D, E or F designs.

Deliver it in **two parts so the first can be approved and built without waiting for the second.**

### Part 1 — slices that do not touch billing (specify these completely, now)

1. **Scheduling (update item C-04).** Optional duration (null means the visible 120-minute estimate in
   `src/domains/jobs/dispatch.ts`), optional assignee, job version check. Conflicts use half-open intervals and must
   include a job that began the previous Denver business day and crosses midnight. Two different jobs assigned to one
   person at the same moment must be serialized: say exactly which row is locked (the user row, in stable id order when two
   people are touched), what is re-checked under the lock, and how the confirmation works so a stale yes/no cannot
   approve a conflict that appeared later (for example, confirm against an explicit list of conflicting job ids).
   Say how "no-show" clears the schedule and leaves custody, inventory and billing untouched.
2. **Asset numbers (C-06).** `createApplianceUnits` in `src/domains/inventory/index.ts` currently finds numbers with a
   `findUnique` loop outside a transaction; `Appliance.assetNumber` is globally `@unique`, and `assetNumberPrefix` can give
   two appliance types the same prefix. Define the counter's key (the prefix, not the appliance type), how it is created
   safely before it is locked (selecting a missing row `FOR UPDATE` locks nothing), how it is seeded from all existing
   numbers in that prefix including nonstandard ones, and all-or-nothing behavior with the unit audits.
3. **Parts ledger and archival (C-07, C12).** Writers today include `recordPartUsage` and `updatePartStockSettings` in
   `src/domains/purchasing/index.ts` (usage clamps with `Math.max(0, ...)`) and `deletePartRecord` in
   `src/domains/inventory/index.ts`. Specify: one movement primitive every writer must go through; deterministic opening
   movements for existing nonzero balances (do not also replay received purchase orders); separate backfill of received
   quantities; durable operation identities so a retried receipt or usage returns its first result while two real partial
   receipts stay separate (give the uniqueness constraint and the payload-consistency check); sorted locks for multi-part
   commands; unknown cost is null and known zero is valid; how legacy hand-entered parts cost coexists with itemized usage
   without double counting; archival of suppliers and parts that keeps history.

### Part 2 — custody, completion, swaps, maintenance, inspection (specify, but mark which parts wait on billing)

Write the literal specification for update items C-01, C-02, C-03, C-05, C-08 and C-10, with these facts from the code:

- `startRenewalInTx` (`src/domains/agreements/renewal-start.ts`) ends each assignment with reason "Moved to the renewal"
  and creates a new one on the renewal's line **without any equipment moving**. `closeAgreement`
  (`src/domains/agreements/index.ts`, `userId` may be null) also ends assignments and moves appliances to AWAITING_PICKUP
  before any pickup job. So custody cannot live on the assignment row or depend on an ACTIVE agreement. Specify the
  physical-custody table (relations to appliance, customer, property, delivery and removal job evidence), "at most one open
  custody episode per appliance" as a database rule, the migration and its honest backfill (use completed-job evidence where
  it exists, otherwise "estimated/unknown"; never copy a reservation time as a delivery), and every call site that must
  change (`startRenewalInTx`, `closeAgreement`, job scope checks, maintenance, swaps, history readers).
- Completion (`updateJobStatus` and `applyJobCompletionToAppliances` in `src/domains/jobs/index.ts`) must store a
  per-appliance result for the confirmed job scope. `StaffTask` has priority `LOW|NORMAL|HIGH` (no URGENT), a `note` (no
  title) and links to a job but not an appliance; `createTask` (`src/domains/tasks/index.ts`) opens its own session and
  transaction, so specify a transaction-capable task primitive. Specify how a retried completion creates no second task,
  audit or billing intent, and the durable billing hand-off record (an interface only; the real billing behavior is the
  shared Batch B contract).
- Swaps: staging locks and validates both the original appliance's custody and the replacement; today
  `startSwapForAppliance` (`src/domains/inventory/guided-actions.ts`) moves the assignment and both units at staging time.
  Completion moves custody atomically and sends the returned unit to AWAITING_INSPECTION; cancel releases only the
  reservation that swap owns; renewal start, rental ending and swap completion share one documented lock order.
- Maintenance: `createJob` opens its own transaction, so specify a transaction-capable job-creation primitive so request
  transition, job link and audit commit together while keeping the existing conditional status update. Job completion does
  **not** resolve maintenance requests today; define when a request resolves (not after a partial, no-show, cancelled or
  unresolved visit).
- Inspection and permissions: store the actual checklist definition with each result (a hash alone cannot rebuild it),
  reject a stale expected-definition version, derive pass/fail on the server, audit OWNER/ADMIN overrides, forbid STAFF
  overrides, and list every domain write that must re-check job-scoped staff authority in its own transaction (completion,
  photos, checklists, inspection, swaps, single/bulk/guided status changes). `swapReplacementIdsFor` in
  `src/domains/desk-access/index.ts` is only a read helper, not the authorization boundary.
- Earnings: `collectedBetween` is customer cash, not per-appliance earnings. Say what the appliance screens show until an
  allocation method is designed (clearly labelled estimates, customer-level cash in its own scope), and keep completed
  inspections, checklists, part movements and custody history immutable (corrections append attributable amendments).

- **Items missing from the first delivery — what happens to the Stripe subscription (owner rule, 2026-10-03; specify
  this fully, it is decided).** The late-delivery credit is already built (`PendingDelivery`,
  `src/domains/billing/pickup-billing-events.ts`; see `docs/ARCHITECTURE.md` "Pickup and delivery billing"). Build on it;
  do not redesign it. The remaining rule is what happens to the item's line on the customer's monthly Stripe subscription:
  1. **Delivered late** (the same appliance arrives on a later delivery job): the line **stays** on the subscription; the
     credit for the missing days is the whole remedy (built).
  2. **Swapped** (a different appliance of the same type is delivered in its place): the line **stays**; the replacement
     takes the waiting item's place on the agreement (assignment moves to the replacement; the waiting record is fulfilled
     by the replacement's delivery job, and the missing-days credit counts to that delivery date). Today `PendingDelivery`
     is keyed by the original appliance id, so specify how a delivery job fulfils a waiting item with an alternate unit of
     the same `ApplianceType` (and what happens if the alternate is a different type: owner decision, not automatic).
  3. **Permanently cancelled** (never delivered and taken off the agreement — `removeUndeliveredItem`): everything billed
     for it is credited (built) **and** the item must come off the Stripe subscription from the next billing period, so the
     customer is not charged for it again. Specify: a durable `SUBSCRIPTION_UPDATE` provider operation (claim → call →
     complete, reconciled like the others) that reduces the matching subscription item's recurring amount by the item's
     monthly share — or deletes the item when the rental line has no appliances left — with Stripe proration **off** (the
     local credit already covers the current period); how the subscription item is found (products carry
     `rentalLineId` in metadata, see `startRecurringBillingForAgreement`); the local amendment to the rental line so
     statements, reports and the customer portal show the reduced rent while the original signed price stays visible as
     history (price snapshots are sacred — append an amendment, never overwrite); the audit entry; what the owner sees
     while the Stripe change is pending or failed (the drift workbench lists it; Today keeps the item until Stripe
     confirms); and the case where **every** item on the agreement is cancelled, which must go through the normal
     agreement-ending path (`closeAgreement`), never a line reduction to zero. Owner/admin only, same as the removal.
  Tests to name: late delivery leaves the subscription unchanged; swap with a same-type unit leaves it unchanged and
  credits to the replacement's date; cancellation reduces exactly one subscription item once (retried call is a no-op,
  Stripe failure leaves a visible pending operation, drift shows a mismatch); all-items-cancelled ends the agreement.

**Billing-dependent pieces (C-09 pickup/return billing) stay blocked.** For
those, write only the interface Batch C needs from the shared billing contract and list what it must not do (no direct
Stripe calls, no second subscription-ending process, no duplicate early-termination fee). Do not decide the owner questions
below.

## Rules the design must respect

Money is integer cents and reuses the Batch B lock order (customer, then invoices in id order, then re-read). Times are
stored in UTC and shown in America/Denver; test spring-forward (2026-03-08), fall-back (2026-11-01), midnight and
month-end. Migrations are additive and must pass `scripts/check-migrations.mjs`. Every new table goes in the schema-health
list, the backup export and `docs/DATABASE.md`. Anything a business might change is a stored, owner-editable setting
explained in plain words on its screen. Everything that could reach a customer ships dormant behind a switch listed in
`docs/GO-LIVE-CHECKLIST.md`. Live customer email, live SMS and live Stripe stay OFF. Keep Package 1's fixes (atomic
maintenance transition, photo authorization, bounded portal reads, atomic audits); do not re-implement them.

## Questions only Chris can answer (do not guess; gate only the money rules)

- IN-24: only the company-caused waiver is still open (who records that a late pickup was the company's fault, and how the
  waived days show on the statement). The customer-caused late-return charge is built (by the day, owner setting).
- IN-26 and IN-27 are answered and built (`docs/OWNER-INPUTS.md`); do not re-ask them. The subscription rule for a
  missing item (above) is also decided.

## Finish with

1. The amendment text, ready to append to `docs/designs/BATCH-C.md`, plus the one-line status for each slice
   (approved for code / blocked on billing / blocked on an owner answer) so `docs/designs/README.md` can be updated.
2. A plain-English summary for Chris: what you decided, what stays blocked and why, and what he must answer.
