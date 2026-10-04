# Design — Batch C: Rental-to-service operations, custody, inventory & purchasing

Status: **NOT APPROVED — do not implement from this document yet.** The implementation-ready text is
`BATCH-C-LITERAL-SPEC-2026-10-03.md` (reviewed 2026-10-03; approval per slice in `README.md`); this file and the
2026-10-03 update are its background. It was
approved on 2026-10-02 (written against `main` f272f51, *before* Batch B
merged) and that approval was withdrawn by the 2026-10-03 amendment below:
the literal schema, signatures and migration order are still to come from the
stronger-model pass (`docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`). The
former approval is kept here only as history. Section 0
tells you what to re-verify because B landed first. Scope and acceptance:
`docs/PLAN.md` → Batch C. Pattern reference for every transactional write:
`docs/designs/BATCH-B.md` D2 (lock → claim → act) and `assertActiveTeamActor`.

> **2026-10-03 (later): the literal schema, signatures, migrations, lock order, tests and stop-and-ask list now exist in `docs/designs/BATCH-C-LITERAL-SPEC-2026-10-03.md`. It wins over this file and the update where they disagree. It is specified but not yet approved by Chris; the table below is superseded by its section 12.**

> **2026-10-03 AMENDMENT (stronger-model design update, applied by the coding agent): this document does NOT authorize implementation unchanged.**
> Read `docs/designs/BATCH-C-UPDATE-2026-10-03.md` first. It amends C1-C11 and the work units (items C-01 to C-10 there: physical custody that survives renewals and endings, per-appliance completion results, a complete swap contract, scheduling under concurrency, atomic maintenance scheduling, asset counters, parts opening balances, inspection snapshots and permissions, the pickup/return billing unit for IN-24, and the appliance-earnings correction). Where this older text and the update disagree, the update wins.
> **Approval state by slice** (literal schema and signatures are still to be supplied by the stronger-model pass before coding):
> | Slice | State |
> |---|---|
> | Asset numbering (C8/C-06), parts ledger and archival (C9, C12/C-07), scheduling (C5/C-04) | Can be designed and approved separately; not blocked by billing. |
> | Custody and completion (C2, C4/C-01, C-02), swaps (C-03), maintenance chain (C-05), inspection and permissions (C-08) | Need the amended design. Custody/completion must be designed together with the shared billing contract. |
> | Pickup/return billing (IN-24, C-09) | Blocked on the shared billing design (deferred Batch B items R1-R4) and on owner answers (IN-24 late-return rule, IN-26 partial delivery, IN-27 pickup day). |
>
> **Drift check, 2026-10-03 (after Batch B completion work, before Batch C code).**
> Checked every row of section 0 against the code on the Batch B stack.
> - **A2, A3, A4, A5, A6, A7, A8, A9 still match** (job completion still uses `updateMany where status` inside a transaction and starts billing after commit; `applyJobCompletionToAppliances` still skips silently on `moved.count !== 1`; `startSwapForAppliance` still moves the assignment and both units at staging time; asset numbers still found by a loop outside a transaction; part usage still clamps to zero; `Job` still has no assignee/duration/version; `ApplianceInspection` and `MaintenanceRequest` unchanged).
> - **A10 still matches**: `swapReplacementIdsFor` in `src/domains/desk-access/index.ts` still decides STAFF swap authority from audit entries.
> - **A1**: `docs/STATUS.md` says Batch C is next once the Batch B completion stack merges.
> - **Moved or new since the design (small, amended here):** new agreement status `SCHEDULED` (a signed renewal waiting to start) is not in force, so C4 job-scope checks and any "active agreement" test must treat it like not-active; `closeAgreement(userId | null, ...)` can now run with no staff member (audit `userId` null), so WU-C4/C5 code that calls it must not assume a user; the new exception `EARLY_ENDING_NOT_DONE` and the notice exception `NOTICE_WAITING` are on Today (add nothing, but do not break their tests); all customer-addressed email must use `sendCustomerEmail` (owner switch, off by default).
> - **Decision-level conflict, work on it is blocked until a stronger model amends this design: IN-24 (billing stops at pickup).** The design has no rule for it, and the code works the opposite way today. `closeAgreement` (used by `endAgreement`, `cancelAgreement` and the nightly early-ending run) cancels the Stripe subscription and releases the appliances to `AWAITING_PICKUP` at the moment the agreement is ended, which is before the pickup job exists or is done. The owner's rule is that billing ends when the customer's appliance is actually picked up, that a pickup later than the agreed end date is free for the extra days when the company is at fault, and that a customer-caused delay is billed (by day or whole month, still open with Chris). That needs a money rule, a new job record of who caused the delay, and a change to when an agreement ends. The prompt for it is `docs/prompts/DESIGN-IN-24-PICKUP-BILLING.md`. Only asset numbering, the parts ledger/archival and scheduling do not depend on it; custody/completion, swaps and maintenance depend on the custody design and the shared billing contract (see the approval table above and section 6 of the update).

## 0. Verify before starting

| # | Assumption | Check |
|---|---|---|
| A1 | Batch B is merged and `docs/STATUS.md` says C is NEXT. | STATUS table. |
| A2 | `updateJobStatus` in `src/domains/jobs/index.ts` still: locks nothing explicitly, uses `updateMany where status` as its claim, calls `applyJobCompletionToAppliances` inside the tx, then `startRecurringBillingForAgreement` after commit. | Read ≈ lines 215–280. If B changed the billing call, keep B's version. |
| A3 | `applyJobCompletionToAppliances` `continue`s silently when `moved.count !== 1`. | Read it (P8 H5 is still open). |
| A4 | `startSwapForAppliance` in `src/domains/inventory/guided-actions.ts` closes the old assignment and opens the new one *at staging time*. | Read ≈ lines 196–260 (P8 H7 still open). |
| A5 | `createApplianceUnits` allocates asset numbers by scanning from 1 with `findUnique` in a loop, outside a transaction. | `src/domains/inventory/index.ts` ≈ 179–238. |
| A6 | `recordPartUsage` clamps to zero (`Math.max(0, …)`). | `src/domains/purchasing/index.ts` ≈ 236. |
| A7 | `Job` has no `assignedToUserId`, `durationMinutes`, `version`; `dispatch.ts` exports `ASSUMED_JOB_DURATION_MINUTES = 120` and `findConflictingJobIds`. | schema + file. |
| A8 | `ApplianceInspection` has `passed`, `checklist` JSON, no version/override fields. | schema. |
| A9 | `MaintenanceRequest` has no `serviceAddressId`. | schema. |
| A10 | Desk access helper `src/domains/desk-access/index.ts` decides STAFF appliance authority from *any* job link (P3 H1). | Read `swapReplacementIdsFor` and its callers. |

## 1. Decisions

**C1. Completion is a physical fact; conflicts become an exception task, never a silent skip and never a refused completion.** (P8 H5.) When a job completes and an appliance is not in the state the lifecycle expects, the job still completes and, in the same transaction, a `StaffTask` (priority URGENT, assigned to the acting user, linked to the job and appliance) is created saying exactly what was expected and what was found. Reason: a driver standing at the curb has already done the work; refusing to record it makes the database lie. The task makes a human reconcile it the same day.

**C2. Custody has its own timestamps.** (RC4.) `ApplianceAssignment.assignedAt` keeps meaning "reserved for this line". New `custodyStartedAt` is written only by DELIVERY/INSTALLATION completion, `custodyEndedAt` only by REMOVAL completion or swap completion — both equal to `job.completedAt`. Reports and the appliance History tab show custody, not reservation.

**C3. A swap is staged on the SWAP job and executed at its completion.** (P8 H7.) Staging writes `Job.swapReplacementApplianceId`, reserves the replacement (`AVAILABLE → RESERVED`, claim via `updateMany where status`), and touches nothing else. Completion, in one transaction: end the old assignment's custody, open the new assignment with custody started, old unit → `MAINTENANCE` (or `AWAITING_INSPECTION` — use the existing lifecycle function), new unit → `RENTED`. Cancelling the SWAP job returns the replacement to `AVAILABLE` and leaves the original assignment untouched. Two staged swaps can't take the same replacement because the claim is `where: { id, status: "AVAILABLE" }`.

**C4. Job scope is validated at the domain boundary by job type.** (P8 H4.) One pure-ish function, called by `createJob` and by any appliance edit on a job. Rules exactly as the audit lists: DELIVERY/INSTALLATION → active assignment on that agreement and status `RESERVED`; REMOVAL → assignment on that agreement with custody started (or status `AWAITING_PICKUP`); MAINTENANCE_VISIT → when agreement/customer is linked, the appliance must be in that customer's custody; SWAP → only through staging (C3), never a free pick.

**C5. Duration and assignee are optional columns; null duration means the documented 120-minute advisory estimate, labelled as such in UI.** Conflicts: same assignee, intervals `[start, start + duration)` overlap; `end === start` is *not* a conflict; unassigned jobs never conflict with anything. All day math in America/Denver via `src/lib/business-date.ts`. `version` on Job makes stale edits rejectable (`updateMany where version`).

**C6. Reschedule is an edit with an explicit confirmation, not a new job; partial / no-show are recorded outcomes.** New nullable `Job.outcome` (`COMPLETED | PARTIAL | NO_SHOW`) is set only when the status becomes COMPLETED (outcome COMPLETED/PARTIAL) or when an operator records NO_SHOW (status stays SCHEDULED and `scheduledAt` is cleared to the unscheduled queue; audit keeps the old time). PARTIAL completes the job but C1 fires for every appliance that did not move. No customer message is ever sent by a schedule change (sending is Batch E and owner-gated).

**C7. Inspection pass is derived from the checklist, with an audited OWNER/ADMIN override.** (P8 H11.) The checklist definition is snapshotted with a `checklistVersion` (sha256 of the item list) so settings edits never rewrite history. Required items = all items in the definition. STAFF cannot override.

**C8. Asset numbers come from a per-type counter row locked in the same transaction that creates every unit and its audit.** (P8 H8.) Batch semantics: all-or-nothing. The counter is `AssetNumberCounter(applianceTypeId, nextSequence)`; seeded lazily from `max(existing)+1` under the lock.

**C9. Parts: never clamp; every stock movement is a row.** (P8 H10, P8 M6.) `PartStockMovement` (kind `RECEIPT | USAGE | CORRECTION | DISCREPANCY`, signed `deltaQuantity`, reason, links) is the ledger; `PartRecord.quantityOnHand` is a cached sum updated under lock in the same transaction. Usage above on-hand is rejected with a plain message and a link to "record a correction" (which creates a `CORRECTION` movement with a required reason). Job repair cost gets provenance through `JobPartUsage` rows (part, quantity, `unitCostCents` snapshot from the latest `RECEIPT` movement's cost, else the PO line, else null → "cost unknown", never 0). Receiving is bounded: `PurchaseOrderLineItem.receivedQuantity ≤ quantity`, partial receives allowed, over-receipt rejected.

**C10. STAFF appliance authority is scoped to a job that is SCHEDULED or IN_PROGRESS *now* and lists that appliance.** (P3 H1.) Completed/cancelled jobs confer nothing.

**C11. Maintenance scheduling requires the full chain.** A MAINTENANCE_VISIT job created from a request must carry `maintenanceRequestId`, `customerId` (= request.customerId), `serviceAddressId` (= request.serviceAddressId, new column, backfilled from the appliance's current assignment's agreement address where derivable, else left null and flagged), `agreementId` (from current custody) and the appliance. Mismatches are rejected.

**C12. Supplier and part records are archived, never deleted.** `archivedAt` on both; `deletePartRecord` becomes archive; archived rows are hidden from pickers but keep history.

## 2. Schema changes (additive)

```prisma
enum JobOutcome { COMPLETED PARTIAL NO_SHOW }

model Job {
  // + Batch C (C5/C6)
  assignedToUserId String?
  assignedTo       User?   @relation("JobAssignee", fields: [assignedToUserId], references: [id])
  durationMinutes  Int?        // null = 120-minute advisory estimate (dispatch.ts)
  version          Int     @default(1)
  outcome          JobOutcome?
  outcomeNotes     String?
  // + Batch C (C3): staged replacement for a SWAP job; executed at completion
  swapReplacementApplianceId String?
  swapReplacementAppliance   Appliance? @relation("SwapReplacement", fields: [swapReplacementApplianceId], references: [id])
  partUsages JobPartUsage[]
  @@index([assignedToUserId, scheduledAt])
}

model ApplianceAssignment {
  // + Batch C (C2): real handoff times, written only by job completion
  custodyStartedAt DateTime?
  custodyEndedAt   DateTime?
}

model ApplianceInspection {
  // + Batch C (C7)
  checklistVersion String?     // sha256 of the definition used; null on pre-C rows
  overrideByUserId String?
  overrideReason   String?
  jobId            String?     // the REMOVAL/MAINTENANCE job this inspection followed, when known
}

model MaintenanceRequest {
  // + Batch C (C11)
  serviceAddressId String?
  serviceAddress   ServiceAddress? @relation(fields: [serviceAddressId], references: [id])
  @@index([serviceAddressId])
}

model AssetNumberCounter {      // C8
  applianceTypeId String @id
  nextSequence    Int
}

enum PartMovementKind { RECEIPT USAGE CORRECTION DISCREPANCY }

model PartStockMovement {       // C9
  id            String           @id @default(cuid())
  partRecordId  String
  partRecord    PartRecord       @relation(fields: [partRecordId], references: [id])
  kind          PartMovementKind
  deltaQuantity Int              // signed
  unitCostCents Int?             // RECEIPT only
  reason        String?          // required for CORRECTION/DISCREPANCY (domain-enforced)
  purchaseOrderLineId String?
  jobId         String?
  userId        String?
  createdAt     DateTime         @default(now())
  @@index([partRecordId, createdAt])
}

model JobPartUsage {            // C9
  id            String     @id @default(cuid())
  jobId         String
  job           Job        @relation(fields: [jobId], references: [id])
  partRecordId  String
  partRecord    PartRecord @relation(fields: [partRecordId], references: [id])
  quantity      Int
  unitCostCents Int?       // snapshot; null = unknown, never 0
  movementId    String     @unique   // the USAGE movement this created
  createdAt     DateTime   @default(now())
  @@index([jobId])
}

model PurchaseOrderLineItem { receivedQuantity Int @default(0) }   // C9
model Supplier   { archivedAt DateTime? }                           // C12
model PartRecord { archivedAt DateTime?  movements PartStockMovement[]  jobUsages JobPartUsage[]  preferredSupplierId String? }  // C12, O17B (nullable, no behavior until set)
model User { assignedJobs Job[] @relation("JobAssignee") }
model Appliance { swapJobs Job[] @relation("SwapReplacement") }
```

Backfill (in the migration, SQL): `PurchaseOrderLineItem.receivedQuantity = quantity` where the PO status is RECEIVED; `ApplianceAssignment.custodyStartedAt = assignedAt` only for assignments whose appliance is currently `RENTED` and whose agreement is ACTIVE (best available truth — documented in `docs/DATABASE.md` as "pre-C custody is approximate"). No other backfill.

## 3. Work units (in order; one commit each)

### WU-C1 — Schema, migration, health, backup, DATABASE.md
As Section 2. `AssetNumberCounter`, `PartStockMovement`, `JobPartUsage` join schema-health and backup. Migration drill passes.

### WU-C2 — Job contract: assignee, duration, version, conflicts (C5)
Closes: O13.
Files: `src/domains/jobs/dispatch.ts`, `src/domains/jobs/index.ts` (`createJob`, new `updateJobSchedule`), `src/app/desk/jobs/actions.ts`, `tests/dispatch-board.test.ts` (extend; also see `tests/jobs-status-concurrency.test.ts` for the claim pattern), `tests/jobs-schedule-integration.test.ts` (new).
```ts
// dispatch.ts
export type DispatchableJob = { id: string; scheduledAt: Date | null; durationMinutes: number | null; assignedToUserId: string | null };
export function effectiveDurationMinutes(job: { durationMinutes: number | null }): { minutes: number; isEstimate: boolean };
export function findConflicts(jobs: DispatchableJob[]): Map<string, string[]>;   // jobId → conflicting jobIds; same assignee only; [start,end) overlap; end===start no conflict
// index.ts
export async function updateJobSchedule(userId: string, input: { jobId: string; expectedVersion: number; scheduledAt: Date | null; durationMinutes: number | null; assignedToUserId: string | null; confirmConflicts: boolean }): Promise<{ job; conflicts: string[] }>;
// inside tx: assertActiveTeamActor; assignee must be an active OWNER/ADMIN/STAFF (archivedAt null) else reject;
// durationMinutes null or 15..720; updateMany where {id, version: expectedVersion} → count 1 else "changed by someone else";
// compute conflicts for that assignee's day (business day bounds); if conflicts.length && !confirmConflicts → throw ConflictsNeedConfirmation(conflicts) BEFORE writing; audit "job.schedule" with old/new.
```
Tests: overlap, touching ends, different assignees, unassigned, null duration = estimate flag, DST days (2026-03-08, 2026-11-01), stale version rejected, archived assignee rejected, (integration) two concurrent schedule edits → one wins.

### WU-C3 — Job scope validation (C4) and STAFF authority (C10)
Closes: P8 H4, P3 H1.
Files: `src/domains/jobs/scope.ts` (new), `src/domains/jobs/index.ts` (`createJob`, appliance edits), `src/domains/desk-access/index.ts`, `tests/jobs-scope.test.ts`, `tests/desk-role-access.test.ts` (extend).
```ts
export async function assertJobApplianceScope(tx, input: { type: JobType; agreementId: string | null; customerId: string | null; applianceIds: string[] }): Promise<void>; // throws plain-English error naming the asset number
export async function staffMayActOnAppliance(tx, userId: string, applianceId: string): Promise<boolean>; // true only if a SCHEDULED/IN_PROGRESS job assigned to userId (or unassigned, if that is today's rule — check desk-access and keep its current openness for unassigned) lists the appliance
```
Tests: each type's accept/reject case from the audit list; cross-customer asset rejected even when ids are valid; completed job confers no authority.

### WU-C4 — Completion: custody timestamps (C2), exception tasks (C1), outcomes (C6)
Closes: P8 H5, RC4 (jobs side).
Files: `src/domains/jobs/index.ts` (`updateJobStatus`, `applyJobCompletionToAppliances`, new `recordNoShow`), `src/domains/tasks` (reuse its create function — do not insert StaffTask directly), `tests/jobs-completion.test.ts` (rewrite), `tests/jobs-completion-integration.test.ts`.
Change: `applyJobCompletionToAppliances` returns `{ moved: string[]; conflicts: Array<{ applianceId; assetNumber; expected; found }> }`; for each conflict create the URGENT task (title `"Appliance <asset> did not move to <expected> — found <found> after <type> job"`, link job+appliance) and audit `appliance.lifecycle_conflict`. DELIVERY/INSTALLATION set `custodyStartedAt = completedAt` on each moved assignment; REMOVAL sets `custodyEndedAt`. `updateJobStatus(..., { outcome?: "COMPLETED"|"PARTIAL" })`. `recordNoShow(userId, jobId, expectedVersion, notes)`.
Tests: appliance changed between read and completion → job COMPLETED + one task; one conflict in a three-appliance delivery → two moved, one task; removal conflict; custody timestamps equal `completedAt`; NO_SHOW leaves lifecycle untouched and clears `scheduledAt`.

### WU-C5 — Staged swap (C3)
Closes: P8 H7.
Files: `src/domains/inventory/guided-actions.ts` (`startSwapForAppliance` → stages), `src/domains/jobs/index.ts` (SWAP completion branch, SWAP cancel branch), `tests/inventory-swap.test.ts` (rewrite), `tests/inventory-swap-integration.test.ts`.
Staging transaction: validate as today (same type, replacement AVAILABLE, old on an active assignment); claim replacement `updateMany where {id, status:"AVAILABLE"} → RESERVED`; create the SWAP job with `swapReplacementApplianceId` and the old appliance in `JobAppliance`; audit. **No assignment changes.** Completion (inside `updateJobStatus` tx, before C1 logic): end old assignment (`unassignedAt`, `custodyEndedAt`, reason "Swapped"), create new assignment with `custodyStartedAt`, old unit → `applianceStatusOnJobCompleted("SWAP", …)` existing rule, new unit `RESERVED → RENTED`. Cancel: replacement `RESERVED → AVAILABLE` (claim), clear the field, audit.
Tests: start then cancel → original assignment intact, replacement AVAILABLE; (integration) two concurrent stagings for one replacement → one succeeds; completion moves custody atomically; completing a SWAP whose replacement was meanwhile changed → C1 task, not silent.

### WU-C6 — Inspection policy (C7)
Closes: P8 H11.
Files: `src/domains/inventory/inspections.ts` (new; move inspection creation here from wherever it lives — grep `applianceInspection.create`), `tests/inventory-inspection.test.ts`.
```ts
export function checklistVersion(items: string[]): string;  // sha256 hex of JSON.stringify(items)
export async function recordInspection(userId, input: { applianceId; jobId?; checklist: ChecklistItem[]; notes?; condition?; override?: { reason: string } }): Promise<{ passed: boolean }>;
// definition = current DEFAULT_INSPECTION_CHECKLIST (or settings list if one exists); reject injected/extra/missing items by name;
// passed = every item checked, unless override (OWNER/ADMIN only, reason ≥ 10 chars) → passed=true with override fields; status via applianceStatusAfterInspection; audit.
```
Tests: missing item, unchecked item, extra item injection, STAFF override rejected, OWNER override recorded, version stored.

### WU-C7 — Asset-number allocator (C8)
Closes: P8 H8.
Files: `src/domains/inventory/index.ts` (`createApplianceUnits`), `tests/inventory-create-units.test.ts`, `tests/inventory-create-units-integration.test.ts`.
One transaction: `SELECT … FROM "AssetNumberCounter" WHERE "applianceTypeId"=$1 FOR UPDATE`; if absent, insert with `nextSequence = (max sequence parsed from existing assetNumbers with this prefix) + 1`; allocate N consecutive numbers; create N units + N audits; update counter. Any failure rolls back all.
Tests: (integration) two concurrent creates of 3 units each → 6 unique consecutive-ish numbers, no gaps within a batch; audit failure mid-batch (inject) → zero units created.

### WU-C8 — Parts ledger, bounded receiving, job part usage (C9)
Closes: P8 H10, P8 M6, O17A.
Files: `src/domains/purchasing/index.ts` (`recordPartUsage` → reject; new `recordPartCorrection`, `receivePurchaseOrderLines`), `src/domains/purchasing/movements.ts` (new helper `applyMovement(tx, …)` that inserts the movement and updates the cached quantity under `FOR UPDATE`), `src/domains/jobs/index.ts` (`recordJobPartUsage(userId, jobId, partRecordId, quantity)` — creates USAGE movement + JobPartUsage; `setJobRepairCosts` keeps working but `partsCostCents` becomes derived when usages exist: sum of `quantity × unitCostCents` for known costs, with an "unknown cost" flag if any null), `tests/purchasing-*.test.ts`.
Tests: exact depletion ok; over-consumption rejected with message; correction requires reason; receiving above remaining rejected; partial receive twice equals once full; (integration) concurrent receive and usage → cached quantity equals the movement sum.

### WU-C9 — Maintenance chain (C11)
Closes: maintenance scheduling acceptance.
Files: `src/domains/maintenance/index.ts` (`scheduleVisit(userId, requestId, input)` creating the job through `createJob` with the derived links), `src/app/desk/maintenance/*` actions, portal request creation (set `serviceAddressId` from the chosen property), `tests/maintenance-schedule.test.ts`.
Tests: derived links set; mismatch (appliance not in that customer's custody) rejected; request → job → completion moves request to RESOLVED via existing transition rules.

### WU-C10 — Dispatch and job detail UI (C5/C6)
Closes: O14.
Files: `src/app/desk/jobs/**` (board, job detail panel, new reschedule form), `src/app/desk/dispatch/**` if it exists (grep "dispatch" in `src/app/desk`), `e2e/dispatch-calendar-recovery.spec.ts` (extend) → assign to the lightest shard group.
Spec (from DESIGN.md §6): phone default = agenda; desktop = day; unscheduled queue visible; card shows time window, type, city, assignee, equipment, checklist progress; "(estimated)" label on 120-min fallback; reschedule form shows the conflicts list and the customer/job affected and requires a confirm checkbox when conflicts exist; cancelled/completed never render as active; NO_SHOW button with notes.
Tests: one browser flow: schedule → conflict shown → confirm → saved; axe clean at 360/768/1440.

### WU-C11 — Driver view & maintenance workflow polish (O15), appliance record (O16)
Files: `src/app/desk/driver/**` (or wherever `getDriverJobsForToday` renders), `src/app/desk/inventory/[id]/**` tabs (Overview / History / Photos / Costs & earnings / Parts), `src/app/desk/maintenance/**` queue groups.
Rules: checklist → photos → notes → complete order; upload progress and error states; a failed upload never marks complete; repeated completion is a no-op (status claim); History tab = custody rows (C2) + inspections (with override badge) + jobs; earnings labelled "estimate" vs "collected" (reuse Batch B `collectedBetween`); QR deep link still requires login (verify existing); Parts tab = movements + job usages.
Tests: unit on the History DTO builder; browser: `e2e/staff-job-follow-up.spec.ts` extended for the driver completion path; axe.

### WU-C12 — Archival (C12), B-register items, docs, PR
Supplier/part archive instead of delete; pickers filter `archivedAt: null`. B02, B04, B05, B10, B14, B16, B17, B25, B29, B32, B33: read each row in `docs/reviews/2026-10-01-business-logic-audit.md`, map to the WU above that satisfies it, and write the disposition line in the PR; anything not covered → stop-and-ask. Update `docs/BUSINESS-RULES.md` (custody, swap, inspection, parts ledger, conflicts), `docs/DATABASE.md`, `docs/OWNER-GUIDE.md` (driver/dispatch changes), `docs/STATUS.md`.

## 4. Stop-and-ask
1. Any Section 0 assumption false.
2. Whether unassigned jobs should be visible to all STAFF for appliance actions (C10 keeps today's rule; if desk-access currently restricts, keep that instead) — note which you kept.
3. Any reorder-point behavior beyond a nullable column (O17B) — not in this batch unless Chris asks.
4. A part with usages but no cost anywhere → shown as "cost unknown"; do not estimate.

## 5. Acceptance mapping
End-to-end scenario (PLAN C line 1) = `tests/operations-lifecycle-integration.test.ts` (new, real DB): agreement → delivery job → complete (custody started, billing call made — mock Stripe) → maintenance request → scheduled visit → staged swap → complete → removal → inspection pass → AVAILABLE. Every other PLAN line maps to the WU tests named above.
