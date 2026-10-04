# Batch C — literal specification (amendment to `BATCH-C.md`, 2026-10-03)

Written by Claude (Sonnet 5.5, not the stronger model) at Chris's direction, after reading the code at `main` b72f05d
plus PR #164/#165 (`pb165`, head 3d71449). **Status: SPECIFIED, WAITING FOR CHRIS'S APPROVAL.** Nothing here is
approved for code until Chris approves it in `docs/designs/README.md`. Where this file and the older
`BATCH-C.md` / `BATCH-C-UPDATE-2026-10-03.md` disagree, this file wins; where it is silent, the update wins.
Docs only: no application code was written for this document.

The shape follows `docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`: Part 1 (no billing) and Part 2 (custody and
service work), then the missing-item subscription rule, the blocked billing interface, tests and stop-and-ask list.

## 0. Rules that apply to every slice

- Money is integer cents. Times are stored UTC and shown in America/Denver (`src/lib/business-date.ts`). Every slice's
  tests include spring-forward (2026-03-08), fall-back (2026-11-01), midnight and month-end where a date matters.
- Migrations are additive (no DROP/RENAME/SET NOT NULL — `scripts/check-migrations.mjs` blocks those). Every new table
  is added to `BACKUP_MODEL_POLICY` (`src/domains/backup/manifest.ts`, a missing entry fails typecheck), `docs/DATABASE.md`,
  and is covered automatically by `verifySchemaHealth` (`src/lib/schema-health.ts` loops over every model).
- Every business rule that Chris might change is a `BusinessSettings` column with an on-screen plain-English
  explanation (AGENTS.md). New settings are listed per slice.
- Anything that can reach a customer ships dormant behind an existing switch (live email/SMS/Stripe stay OFF). Nothing
  in this batch sends email or SMS; the one Stripe change (section 8) goes through the durable provider-operation path.
- **One lock order for every Batch C command** (extends Batch B's "customer, then invoices in id order"). Take locks
  in this order and never go back up; re-read after locking:
  1. `User` rows, sorted by id (`FOR UPDATE` when scheduling, `FOR SHARE` through `assertActiveTeamActor` otherwise; if
     the actor is also in the scheduling set, lock it `FOR UPDATE` first and then call `assertActiveTeamActor`, so two
     transactions never both hold SHARE and wait to upgrade)
  2. `Customer` (`lockCustomerLedger`, `src/domains/billing/ledger.ts:27`) — only when money is touched
  3. `RentalAgreement` (`lockRentalAgreementInTx`, `src/domains/agreements/index.ts:59`)
  4. `MaintenanceRequest`
  5. `Job` rows, sorted by id
  6. `Appliance` rows, sorted by id (`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`)
  7. `PendingDelivery` rows, sorted by id
  8. `PartRecord` rows, sorted by id
  9. `AssetNumberCounter` (a command that creates units takes only this; it touches nothing above)
  Commands that must find a row's parent before locking (a pending item's agreement, a job's maintenance request) read
  the parent id without a lock, lock in the order above, and re-verify the child under its lock.
- Retried requests return the first result and change nothing (each slice names its identity).

## Part 1 — slices that do not touch billing

### P1-A. Scheduling (update item C-04)

**Decisions (with reasons)**
1. `Job.durationMinutes` is optional, 15–720. `null` means "use the owner's default estimate", stored as
   `BusinessSettings.defaultJobDurationMinutes` (starting value 120, matching today's constant
   `ASSUMED_JOB_DURATION_MINUTES` at `src/domains/jobs/dispatch.ts:16`). The constant becomes the fallback used only when
   settings cannot be read. Reason: AGENTS.md says nothing a business might change stays hard-coded.
2. `Job.assignedToUserId` is optional. Conflicts are enforced only between jobs with the **same assignee**. Unassigned
   jobs are never blocked by the domain; the dispatch board still flags overlapping unassigned jobs as one shared
   "unassigned" group (a hint only), which preserves today's one-person behavior.
3. Conflicts use half-open intervals `[start, start + duration)`. Back-to-back jobs (one ends exactly when the next
   starts) do not conflict. The check works on absolute instants, never on day keys, so a job that began the previous
   Denver day and crosses midnight is found (the candidate window looks back 720 minutes, the maximum duration).
4. Considered statuses: `SCHEDULED` and `IN_PROGRESS`. `COMPLETED` and `CANCELLED` free the person's time.
5. Serialization: the **assignee `User` rows** are locked, in id order, before any job row (lock order step 1). If a job
   moves from person A to person B, both are locked. Reason: a conflict check against two different jobs cannot be
   protected by locking either job; the person is the thing being double-booked.
6. Confirmation cannot go stale: the caller sends `confirmedConflictJobIds`. Under the lock the server recomputes the
   conflict set `C`. If `C` is not a subset of the confirmed list the call fails with `JobScheduleConflictError` carrying
   the current `C`; the screen shows it and the person confirms that exact list. A yes given for job X can never approve a
   later conflict with job Y.
7. `Job.version` (starts at 1) increments on every domain write to the job (schedule, status change, completion,
   checklist, repair costs, no-show). A save with an older `expectedVersion` fails with `JobVersionError`. Photos do not
   change the version.
8. **No-show** = status `CANCELLED` plus `Job.noShowAt` set. It removes the job from the person's schedule and does
   nothing else: no appliance status move, no custody change, no assignment change, no `PendingDelivery`, no credit, no
   invoice line, no billing handoff. It does not call `applyJobCompletionToAppliances`. Allowed from `SCHEDULED` /
   `IN_PROGRESS`, by OWNER/ADMIN or by a STAFF member assigned to that job.
9. Who may schedule: OWNER and ADMIN only (`createJob` already requires this, `src/domains/jobs/index.ts:189`). The
   assignee must be an active OWNER/ADMIN/STAFF user, checked under the lock.

**Schema (literal)**
```prisma
// add to model Job:
  assignedToUserId String?
  assignedTo       User?     @relation("JobAssignedTo", fields: [assignedToUserId], references: [id], onDelete: SetNull)
  durationMinutes  Int?
  version          Int       @default(1)
  noShowAt         DateTime?
  @@index([assignedToUserId, scheduledAt])

// add to model User:
  assignedJobs Job[] @relation("JobAssignedTo")

// add to model BusinessSettings:
  defaultJobDurationMinutes Int @default(120)
```
**Migration `20261003290000_job_scheduling`** (additive; runs first, no backfill needed):
```sql
ALTER TABLE "Job" ADD COLUMN "assignedToUserId" TEXT, ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "noShowAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD CONSTRAINT "Job_durationMinutes_range"
  CHECK ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 15 AND 720);
ALTER TABLE "BusinessSettings" ADD COLUMN "defaultJobDurationMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_defaultJobDuration_range"
  CHECK ("defaultJobDurationMinutes" BETWEEN 15 AND 720);
CREATE INDEX "Job_assignedToUserId_scheduledAt_idx" ON "Job"("assignedToUserId","scheduledAt");
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
(The `ADD COLUMN ... NOT NULL DEFAULT` form is not flagged by the migration checker; if it is, stop and ask.)

**Signatures (literal, `src/domains/jobs/scheduling.ts`, new file)**
```ts
export type JobInterval = { start: Date; end: Date };
export function jobInterval(job: { scheduledAt: Date; durationMinutes: number | null }, defaultMinutes: number): JobInterval;
export function intervalsOverlap(a: JobInterval, b: JobInterval): boolean; // a.start < b.end && b.start < a.end

export type JobConflict = { jobId: string; type: JobType; scheduledAt: Date; durationMinutes: number | null; customerName: string | null };
export class JobScheduleConflictError extends Error { constructor(readonly conflicts: JobConflict[]); }
export class JobVersionError extends Error {}

export async function findAssigneeConflicts(
  tx: Prisma.TransactionClient,
  args: { assigneeUserId: string; interval: JobInterval; excludeJobId: string | null; defaultMinutes: number },
): Promise<JobConflict[]>;

export type ScheduleJobInput = {
  jobId: string;
  expectedVersion: number;
  scheduledAt: Date;
  durationMinutes: number | null;
  assignedToUserId: string | null;
  confirmedConflictJobIds: readonly string[];
};
export async function scheduleJob(userId: string, input: ScheduleJobInput): Promise<{ jobId: string; version: number; overriddenConflictJobIds: string[] }>;
export async function markJobNoShow(userId: string, jobId: string, expectedVersion: number): Promise<{ version: number }>;
```
`createJob` (`src/domains/jobs/index.ts:187`) is split into `createJobInTx(tx, userId, input)` (everything after its
`assertActiveTeamActor`) and a thin `createJob` that opens the transaction. `NewJobInput` gains
`assignedToUserId?`, `durationMinutes?`, `confirmedConflictJobIds?`; when `scheduledAt` and an assignee are both set,
`createJobInTx` runs the same conflict check (the new job has no id yet, so `excludeJobId = null`). `findConflictingJobIds`
in `dispatch.ts` takes `defaultMinutes` and groups by `assignedToUserId` (null group = unassigned).

Conflict query inside the lock (candidate window then exact overlap in code; `$1` etc. are bound parameters):
```sql
SELECT j."id", j."type", j."scheduledAt", j."durationMinutes"
FROM "Job" j
WHERE j."assignedToUserId" = $1
  AND j."status" IN ('SCHEDULED','IN_PROGRESS')
  AND j."scheduledAt" IS NOT NULL
  AND j."scheduledAt" <  $2                         -- candidate end
  AND j."scheduledAt" >= $3 - INTERVAL '720 minutes' -- candidate start minus the maximum duration
  AND ($4::text IS NULL OR j."id" <> $4)
```
**Order of operations in `scheduleJob`:** read the job's current assignee (no lock) → lock User rows `{actor, old assignee,
new assignee}` sorted by id → `assertActiveTeamActor(OWNER, ADMIN)` → check the new assignee is active → lock the `Job`
row, compare `version` to `expectedVersion` → compute conflicts → compare with `confirmedConflictJobIds` → `UPDATE "Job"
SET ..., "version" = "version" + 1 WHERE "id" = $1 AND "version" = $2` (must affect one row) → audit `job.schedule`
(old/new time, duration, assignee, overridden conflict ids).

**Owner setting screen text (Settings → Jobs):** "Usual visit length. When a job has no length of its own, the schedule
assumes this many minutes. It is used to warn you when two visits for the same person overlap. Starting value 120
(2 hours). Anyone with owner or admin access can change it. Restore recommended value."

### P1-B. Asset numbers (update item C-06)

**Decisions**
1. The counter is keyed by the **prefix** (the thing that must be unique together with a sequence), not by appliance
   type: two types can share a prefix (`assetNumberPrefix`, `src/domains/inventory/index.ts:50`; "Washer" and
   "Washboard" are both `WASH`).
2. Numbers are never reused. Today's scan from 1 (`index.ts:196-199`) fills gaps; the counter only moves forward.
3. The counter row is **created first** (`INSERT ... ON CONFLICT DO NOTHING`, seeded from existing numbers), **then
   locked** (`SELECT ... FOR UPDATE`) — selecting a missing row locks nothing.
4. The seed is `1 + max(sequence)` over every existing `Appliance.assetNumber` matching `^<PREFIX>-[0-9]{1,9}$`
   (any zero-padding). Numbers that do not match the pattern (hand-made, other case) do not move the counter; inside the
   lock, a candidate that already exists is skipped (the counter advances past it).
5. Creating N units is one transaction: counter, all N units and all N audit rows commit or roll back together.
   Quantity must be 1–50.

**Schema**
```prisma
model AssetNumberCounter {
  prefix       String   @id            // 1–6 characters, A–Z 0–9, from assetNumberPrefix()
  nextSequence Int                      // the next number to hand out
  updatedAt    DateTime @updatedAt
}
```
**Migration `20261003300000_asset_number_counter`:**
```sql
CREATE TABLE "AssetNumberCounter" ("prefix" TEXT NOT NULL, "nextSequence" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AssetNumberCounter_pkey" PRIMARY KEY ("prefix"));
ALTER TABLE "AssetNumberCounter" ADD CONSTRAINT "AssetNumberCounter_next_positive" CHECK ("nextSequence" >= 1);
INSERT INTO "AssetNumberCounter" ("prefix","nextSequence","updatedAt")
SELECT split_part("assetNumber",'-',1), MAX(CAST(split_part("assetNumber",'-',2) AS INTEGER)) + 1, NOW()
FROM "Appliance" WHERE "assetNumber" ~ '^[A-Z0-9]{1,6}-[0-9]{1,9}$'
GROUP BY split_part("assetNumber",'-',1)
ON CONFLICT ("prefix") DO NOTHING;
```
**Signatures**
```ts
// src/domains/inventory/asset-numbers.ts (new)
export async function allocateAssetNumbers(tx: Prisma.TransactionClient, prefix: string, count: number): Promise<string[]>;
// createApplianceUnits keeps its public signature (src/domains/inventory/index.ts:179); its body becomes one
// prisma.$transaction: allocateAssetNumbers -> appliance.create x N -> auditLog.create x N.
```
`allocateAssetNumbers`: (1) `INSERT INTO "AssetNumberCounter" (prefix,"nextSequence","updatedAt") SELECT $1, COALESCE(MAX(CAST(substring("assetNumber" from '^' || $1 || '-([0-9]{1,9})$') AS INTEGER)),0)+1, NOW() FROM "Appliance" WHERE "assetNumber" ~ ('^' || $1 || '-[0-9]{1,9}$') ON CONFLICT ("prefix") DO NOTHING`;
(2) `SELECT "nextSequence" FROM "AssetNumberCounter" WHERE "prefix" = $1 FOR UPDATE`; (3) loop: candidate
`buildAssetNumber(prefix, n)`; skip if it exists; stop at `count`; refuse if `n > 999999999`; (4) `UPDATE` the counter to
the next unused value.

### P1-C. Parts ledger and archival (update item C-07, plan C12)

**Decisions**
1. Every change to `PartRecord.quantityOnHand` goes through one primitive, `applyPartMovementsInTx`. The writers today
   are `receivePurchaseOrder` (`src/domains/purchasing/index.ts:182`), `recordPartUsage` (`:236`),
   `updatePartStockSettings` (`:266`) and none outside that file (checked by grep of `quantityOnHand` in `src/`).
   `quantityOnHand` stays as a stored total, always equal to the sum of the part's movements (a test checks it).
2. **No silent clamp.** Using more than is on hand is refused (`InsufficientStockError`: "Only 2 on hand. Recount first
   if the shelf count is wrong."). The old `Math.max(0, ...)` (`index.ts:246`) is removed.
3. Existing nonzero balances get one deterministic `OPENING_BALANCE` movement each (`operationKey = 'opening:' + partId`,
   cost unknown). **Received purchase orders are not replayed into movements**; their line quantities are copied to
   `PurchaseOrderLineItem.receivedQuantity` by a separate backfill so partial receipts work from here on.
4. Identity of a request is `operationKey` (a random id the screen creates when the form opens). Same key + same
   payload returns the first result (`replayed: true`); same key + different payload throws
   `PartOperationConflictError`; a second real partial receipt uses a new key and applies. Uniqueness:
   `@@unique([partRecordId, operationKey])`; payload check: every row of one operation stores the same
   `payloadHash` (sha256 of the canonical JSON of the request list), compared after the part locks.
5. Cost: `unitCostCents` is `null` when unknown and `0` only when the owner entered 0. Legacy `PurchaseOrderLineItem.unitCostCents`
   defaults to 0 and cannot say which; a new `unitCostKnown` flag (backfilled true only where the old value is > 0)
   fixes this without rewriting data.
6. A usage movement records the part's **last known purchase cost** (most recent receipt with a known cost) as a labelled
   estimate, or `null`.
7. **No double counting of repair costs.** If a job has any `USAGE` movement with its `jobId`, its parts cost is the sum
   of those movements' known costs (plus a count of unknown-cost lines shown as "n parts without a price"), and
   `setJobRepairCosts` rejects a hand-entered `partsCostCents` for that job. Otherwise the legacy `Job.partsCostCents` is
   used. The itemized total is derived on read and never written into `partsCostCents`. Helper:
   `jobPartsCost(client, jobId): Promise<{ source: "ITEMIZED" | "LEGACY" | "NONE"; cents: number | null; unknownCostLines: number }>`.
8. Archival keeps history. Suppliers and parts get `archivedAt`. A part or supplier with any movement, purchase-order line
   or purchase order can only be archived, never deleted; one with no history may still be deleted (a typo). Archived
   items are hidden from pickers and reorder alerts, shown with a "Show archived" switch, and can be restored. An
   archived part still accepts `RECEIPT` (an order already placed), `RECOUNT`, `ADJUSTMENT`; it rejects `USAGE`. A new
   purchase order cannot use an archived supplier.
9. Movements are append-only: a database trigger blocks UPDATE and DELETE on `PartStockMovement`. A mistake is fixed
   by a `REVERSAL` movement (`reversesMovementId`, unique) plus a new correct movement.

**Schema**
```prisma
enum PartMovementKind { OPENING_BALANCE RECEIPT USAGE ADJUSTMENT RECOUNT REVERSAL }

model PartStockMovement {
  id                      String           @id @default(cuid())
  partRecordId            String
  partRecord              PartRecord       @relation(fields: [partRecordId], references: [id])
  kind                    PartMovementKind
  quantityDelta           Int              // signed, never 0
  balanceAfter            Int              // never negative
  unitCostCents           Int?             // null = unknown; 0 = known zero
  operationKey            String
  payloadHash             String
  purchaseOrderLineItemId String?
  purchaseOrderLineItem   PurchaseOrderLineItem? @relation(fields: [purchaseOrderLineItemId], references: [id])
  jobId                   String?
  job                     Job?             @relation(fields: [jobId], references: [id])
  reversesMovementId      String?          @unique
  reason                  String?
  createdByUserId         String?          // null only for OPENING_BALANCE
  createdAt               DateTime         @default(now())

  @@unique([partRecordId, operationKey])
  @@index([partRecordId, createdAt])
  @@index([jobId])
  @@index([purchaseOrderLineItemId])
}
// add to PartRecord:   movements PartStockMovement[];  archivedAt DateTime?
// add to Supplier:     archivedAt DateTime?
// add to PurchaseOrderLineItem: receivedQuantity Int @default(0);  unitCostKnown Boolean @default(false);  movements PartStockMovement[]
// add to Job: partMovements PartStockMovement[]
```
**Migrations (this order)**
1. `20261003310000_parts_ledger_structure`: create the enum and table; add the three columns; `ALTER TABLE "PartRecord" ADD CONSTRAINT "PartRecord_quantityOnHand_nonneg" CHECK ("quantityOnHand" >= 0);`
   `ALTER TABLE "PartStockMovement" ADD CONSTRAINT "PartStockMovement_delta_nonzero" CHECK ("quantityDelta" <> 0 AND "balanceAfter" >= 0);`
   the append-only trigger:
   ```sql
   CREATE FUNCTION "part_movement_append_only"() RETURNS trigger AS $$
   BEGIN RAISE EXCEPTION 'Part movements cannot be changed or deleted; add a reversal instead.'; END; $$ LANGUAGE plpgsql;
   CREATE TRIGGER "PartStockMovement_append_only" BEFORE UPDATE OR DELETE ON "PartStockMovement"
     FOR EACH ROW EXECUTE FUNCTION "part_movement_append_only"();
   ```
2. `20261003320000_parts_opening_balances` (data): 
   ```sql
   INSERT INTO "PartStockMovement" ("id","partRecordId","kind","quantityDelta","balanceAfter","unitCostCents","operationKey","payloadHash","reason","createdAt")
   SELECT 'opening_' || "id", "id", 'OPENING_BALANCE', "quantityOnHand", "quantityOnHand", NULL,
          'opening:' || "id", 'opening', 'Balance when the ledger started', NOW()
   FROM "PartRecord" WHERE "quantityOnHand" > 0;
   ```
3. `20261003330000_parts_received_backfill` (data, separate on purpose):
   ```sql
   UPDATE "PurchaseOrderLineItem" l SET "receivedQuantity" = l."quantity"
   FROM "PurchaseOrder" p WHERE p."id" = l."purchaseOrderId" AND p."status" = 'RECEIVED';
   UPDATE "PurchaseOrderLineItem" SET "unitCostKnown" = true WHERE "unitCostCents" > 0;
   ```
4. `20261003335000_supplier_part_archival` can be folded into step 1 (columns only).

**Signatures (`src/domains/purchasing/ledger.ts`, new)**
```ts
export type PartMovementRequest = {
  partRecordId: string;
  kind: "RECEIPT" | "USAGE" | "ADJUSTMENT" | "RECOUNT" | "REVERSAL";
  quantityDelta?: number;          // RECEIPT/USAGE/ADJUSTMENT/REVERSAL: signed non-zero (USAGE negative)
  countedQuantity?: number;        // RECOUNT only: the delta is computed under the lock
  unitCostCents: number | null;
  purchaseOrderLineItemId?: string;
  jobId?: string;
  reversesMovementId?: string;
  reason?: string;
};
export class InsufficientStockError extends Error {}
export class PartOperationConflictError extends Error {}
export async function applyPartMovementsInTx(
  tx: Prisma.TransactionClient, actorUserId: string | null, operationKey: string, requests: readonly PartMovementRequest[],
): Promise<{ movements: PartStockMovement[]; replayed: boolean }>;
export async function jobPartsCost(client: Prisma.TransactionClient | PrismaClient, jobId: string):
  Promise<{ source: "ITEMIZED" | "LEGACY" | "NONE"; cents: number | null; unknownCostLines: number }>;
export async function findPartLedgerMismatches(client: PrismaClient): Promise<Array<{ partRecordId: string; stored: number; summed: number }>>;

// public commands (replace the three writers in src/domains/purchasing/index.ts):
export async function receivePurchaseOrderLines(userId: string,
  input: { purchaseOrderId: string; operationKey: string; lines: { lineId: string; quantity: number; unitCostCents: number | null }[] }): Promise<{ replayed: boolean }>;
export async function receivePurchaseOrder(userId: string, purchaseOrderId: string): Promise<void>; // = receive every remaining quantity; operationKey 'po-receive-all:' + id
export async function recordPartUsage(userId: string, partRecordId: string, quantity: number,
  options: { operationKey: string; jobId?: string }): Promise<PartRecord>;
export async function updatePartStockSettings(userId: string, partRecordId: string,
  input: PartStockSettingsInput & { operationKey: string }): Promise<PartRecord>; // a changed quantity writes a RECOUNT movement
export async function archivePartRecord(userId: string, partRecordId: string): Promise<void>;
export async function restorePartRecord(userId: string, partRecordId: string): Promise<void>;
export async function archiveSupplier(userId: string, supplierId: string): Promise<void>;
export async function restoreSupplier(userId: string, supplierId: string): Promise<void>;
// deletePartRecord (src/domains/inventory/index.ts:476) refuses when any movement or PO line exists and tells the person to archive.
```
`applyPartMovementsInTx` order: validate key (8–100 chars `[A-Za-z0-9:_-]`) → hash → look up existing rows for the key (fast
path) → lock `PartRecord` rows sorted by id → look up again → for each request in order compute `balance + delta`,
reject `< 0`, insert the movement, → update the stored total → audit one `part.movement` row per operation. `P2002` on the
unique key is treated as a replay check. `receivePurchaseOrderLines` locks the `PurchaseOrder` row first (status must be
`ORDERED`), validates each quantity `<= quantity - receivedQuantity`, calls the primitive, bumps `receivedQuantity`, and
sets the order `RECEIVED` + `receivedAt` only when every line is complete. A cancelled order keeps stock already received.

## Part 2 — custody, completion, swaps, maintenance, inspection, earnings

### P2-A. Physical custody (update item C-01)

**Decisions**
1. Custody is its own table. It is **not** tied to `ApplianceAssignment` (which `startRenewalInTx` ends and recreates at
   `src/domains/agreements/renewal-start.ts:151-162` without any equipment moving, and which `closeAgreement`
   ends at `src/domains/agreements/index.ts:608-640` before any pickup) and **not** to an ACTIVE agreement.
2. An episode **opens** when a completed delivery/installation (or swap replacement) job records `DELIVERED` for the
   appliance, and **closes** when a completed removal (or swap return) job records `RETURNED`. Nothing else opens or closes it.
   Renewal start, agreement ending and assignment changes never touch it.
3. Database rule: at most one open episode per appliance (partial unique index). A second open episode is a unique
   violation, never a silent overwrite.
4. Invariant (tested): an appliance is `RENTED` or `AWAITING_PICKUP` **iff** it has an open episode.
5. Dates are Colorado business dates (the `jobServiceDate` value, `src/domains/billing/pickup-billing-events.ts:54`), stored as the
   Colorado-midnight instant like `Job.performedOn`. An unknown date is `NULL`, never a guess. A reservation time
   (`ApplianceAssignment.assignedAt`) is never copied as a delivery date.

**Schema**
```prisma
enum CustodyEvidence { JOB ESTIMATED MANUAL }

model ApplianceCustodyEpisode {
  id               String          @id @default(cuid())
  applianceId      String
  appliance        Appliance       @relation(fields: [applianceId], references: [id])
  customerId       String
  customer         Customer        @relation(fields: [customerId], references: [id])
  serviceAddressId String?
  serviceAddress   ServiceAddress? @relation(fields: [serviceAddressId], references: [id])
  agreementId      String?         // the agreement it started under, for context only
  startedOn        DateTime?       // null = unknown (only with ESTIMATED)
  startEvidence    CustodyEvidence
  startJobId       String?
  startJob         Job?            @relation("CustodyStartJob", fields: [startJobId], references: [id])
  closedAt         DateTime?       // null = open
  endedOn          DateTime?
  endEvidence      CustodyEvidence?
  endJobId         String?
  endJob           Job?            @relation("CustodyEndJob", fields: [endJobId], references: [id])
  endReason        String?         // "Returned" | "Swapped out" | text for MANUAL
  createdAt        DateTime        @default(now())

  @@unique([startJobId, applianceId])
  @@unique([endJobId, applianceId])
  @@index([applianceId, closedAt])
  @@index([customerId])
}
// back-relations: Appliance.custodyEpisodes, Customer.custodyEpisodes, ServiceAddress.custodyEpisodes, Job.custodyStarted / custodyEnded
```
**Migration `20261003340000_custody_episodes`** (structure): create enum + table, FKs, then
```sql
CREATE UNIQUE INDEX "ApplianceCustodyEpisode_one_open_per_appliance" ON "ApplianceCustodyEpisode"("applianceId") WHERE "closedAt" IS NULL;
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "Custody_closed_consistent"
  CHECK (("closedAt" IS NULL) = ("endEvidence" IS NULL));
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "Custody_estimated_date_ok"
  CHECK ("startEvidence" = 'ESTIMATED' OR "startedOn" IS NOT NULL);
```
**Migration `20261003350000_custody_backfill`** (data, runs after the structure; honest evidence only):
```sql
-- 1. Appliances now with a customer (RENTED / AWAITING_PICKUP) that have a COMPLETED delivery/installation or swap job.
INSERT INTO "ApplianceCustodyEpisode" ("id","applianceId","customerId","serviceAddressId","agreementId","startedOn","startEvidence","startJobId","createdAt")
SELECT DISTINCT ON (ja."applianceId") 'bf_' || ja."applianceId", ja."applianceId", j."customerId", j."serviceAddressId", j."agreementId",
       COALESCE(j."performedOn", date_trunc('day', j."completedAt" AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver'),
       'JOB', j."id", NOW()
FROM "JobAppliance" ja JOIN "Job" j ON j."id" = ja."jobId" JOIN "Appliance" a ON a."id" = ja."applianceId"
WHERE a."status" IN ('RENTED','AWAITING_PICKUP') AND j."status" = 'COMPLETED' AND j."customerId" IS NOT NULL
  AND j."type" IN ('DELIVERY','INSTALLATION','SWAP') AND j."completedAt" IS NOT NULL
ORDER BY ja."applianceId", j."completedAt" DESC;
-- 2. Remaining RENTED / AWAITING_PICKUP appliances: customer from the open (or latest) assignment's agreement, date unknown.
INSERT INTO "ApplianceCustodyEpisode" ("id","applianceId","customerId","serviceAddressId","agreementId","startedOn","startEvidence","createdAt")
SELECT DISTINCT ON (a."id") 'bf_' || a."id", a."id", g."customerId", g."serviceAddressId", g."id", NULL, 'ESTIMATED', NOW()
FROM "Appliance" a JOIN "ApplianceAssignment" s ON s."applianceId" = a."id"
  JOIN "RentalLine" l ON l."id" = s."rentalLineId" JOIN "RentalAgreement" g ON g."id" = l."agreementId"
WHERE a."status" IN ('RENTED','AWAITING_PICKUP')
  AND NOT EXISTS (SELECT 1 FROM "ApplianceCustodyEpisode" e WHERE e."applianceId" = a."id")
ORDER BY a."id", s."assignedAt" DESC;
```
A swap-job match for the returned (original) unit is wrong evidence for a unit that already left; the `a."status"` filter keeps
only units currently with a customer, and the tests include a swapped-out unit. Anything still without an episode (status says
"with a customer", no resolvable customer) is listed by `findCustodyGaps(client)` and shown on Today as exception
`CUSTODY_UNKNOWN`; the owner records a `MANUAL` episode. History before this change stays in jobs and audits; episodes start from the backfill.

**Signatures (`src/domains/inventory/custody.ts`, new)**
```ts
export async function openCustodyEpisodeInTx(tx: Prisma.TransactionClient, input: {
  applianceId: string; customerId: string; serviceAddressId: string | null; agreementId: string | null;
  startedOn: Date; startJobId: string;
}): Promise<{ episodeId: string; alreadyOpenForThisJob: boolean }>;   // other open episode -> CustodyConflictError
export async function closeCustodyEpisodeInTx(tx: Prisma.TransactionClient, input: {
  applianceId: string; endedOn: Date; endJobId: string; endReason: string;
}): Promise<{ episodeId: string; alreadyClosedByThisJob: boolean }>;  // none open -> CustodyConflictError
export async function getOpenCustody(client: PrismaClient | Prisma.TransactionClient, applianceId: string): Promise<ApplianceCustodyEpisode | null>;
export async function findCustodyGaps(client: PrismaClient): Promise<Array<{ applianceId: string; status: ApplianceStatus }>>;
export async function recordManualCustody(userId: string, input: { applianceId: string; customerId: string; serviceAddressId: string | null; startedOn: Date | null; reason: string }): Promise<void>; // OWNER/ADMIN; locks Appliance row; audited
```
**Call sites that change (each with a test)**
- `startRenewalInTx` (`renewal-start.ts:81`): no custody write. It locks the old line's appliances (lock order step 6)
  before moving assignments. Test: open episode id and `startedOn` unchanged after a renewal starts.
- `closeAgreement` (`agreements/index.ts:569`): no custody write; appliances still go to `AWAITING_PICKUP` by
  `applianceStatusOnAgreementClose`. Test: episode stays open after ending with `userId = null`.
- `updateJobStatus` / `applyJobCompletionToAppliances` (`jobs/index.ts:264`, `:397`): replaced by section P2-B.
- Job scope checks (`STAFF` authority, maintenance and removal scope): "this appliance is with this customer" means an open
  episode for `job.customerId`, not an ACTIVE agreement. `ACTIVE_ASSIGNMENT_WHERE`
  (`agreements/active-appliances.ts`) stays as-is for the **customer portal** (agreement-based view); staff scheduling of
  removal or repair for a unit whose agreement already ended uses custody.
- `getApplianceHistory` (`inventory/guided-actions.ts`) gains `kind: "custody"` entries; the appliance page shows the
  current customer from the open episode.
- Swaps: section P2-C. Maintenance: P2-D.

### P2-B. Completion with per-appliance results (update item C-02)

**Decisions**
1. Completing a job takes a result for **every appliance in the job's confirmed scope**, exactly once. Bulk "mark completed"
   and the guided single-status path stop being able to complete a job; `updateJobStatus` keeps `SCHEDULED → IN_PROGRESS`
   and `→ CANCELLED`, and a request for `COMPLETED` throws "Use Complete job so each appliance gets a result."
2. Results by job type: `DELIVERY`/`INSTALLATION`: `DELIVERED` | `NOT_DELIVERED`. `REMOVAL`: `RETURNED` | `NOT_RETURNED`.
   `MAINTENANCE_VISIT`: `REPAIRED` | `NOT_REPAIRED` | `NO_ACCESS`. `SWAP`: the original unit `RETURNED` | `NOT_RETURNED`, the
   replacement `DELIVERED` | `NOT_DELIVERED` (swap rules in P2-C).
3. Job outcome: `COMPLETE` when every result is the positive one (`DELIVERED`/`RETURNED`/`REPAIRED`), otherwise `PARTIAL`.
4. Status moves use the same table as today (`applianceStatusOnJobCompleted`, `inventory/lifecycle.ts:100`). Difference: a
   move whose conditional update affects no row now aborts the whole completion with `JobCompletionConflictError`
   (today it silently `continue`s at `jobs/index.ts:454`).
5. Every negative result creates one follow-up task through the new transaction-capable primitive, `HIGH` priority (the
   enum has no `URGENT`), text in `note`, linked to the job and (new) the appliance, with a `sourceKey` so a retry cannot
   create a second one.
6. A retried completion (same `completionKey`, job already `COMPLETED`) returns `{ replayed: true }` and creates no second
   task, audit row, credit, invoice line, custody change or handoff. A different key against a completed job is an error.
7. The billing work that completion already does inside the transaction (late-return charge, late-delivery credits, "not
   delivered" records, `src/domains/jobs/index.ts:314-358`) stays exactly where it is. Post-commit provider work
   (`pushLateDeliveryCreditToStripe`, `startRecurringBillingForAgreement`, `jobs/index.ts:366-386`) is today lost if the process
   dies after commit; it gets a durable record, `JobBillingHandoff`, written in the same transaction. This is an interface
   only: the shared Batch B billing contract (blocked) decides what executes it; until then the existing post-commit
   calls keep running and mark the handoff `DONE` or `FAILED`.

**Schema**
```prisma
enum JobApplianceResult { DELIVERED NOT_DELIVERED RETURNED NOT_RETURNED REPAIRED NOT_REPAIRED NO_ACCESS }
enum JobApplianceRole   { PRIMARY REPLACEMENT }
enum JobOutcome         { COMPLETE PARTIAL }
enum HandoffKind        { START_RECURRING_BILLING PUSH_CREDIT }
enum HandoffStatus      { PENDING DONE FAILED }

// add to model JobAppliance:
  role                      JobApplianceRole   @default(PRIMARY)
  result                    JobApplianceResult?
  resultNote                String?
  resultRecordedAt          DateTime?
  resultRecordedByUserId    String?
  reservationActive         Boolean            @default(false)   // a staged swap/substitution owns this unit's RESERVED status
  fulfilsPendingDeliveryId  String?
  fulfilsPendingDelivery    PendingDelivery?   @relation("PendingSubstitute", fields: [fulfilsPendingDeliveryId], references: [id])
  @@unique([jobId, applianceId])

// add to model Job:
  outcome        JobOutcome?
  outcomeNotes   String?
  completionKey  String?  @unique
  handoffs       JobBillingHandoff[]

// add to model StaffTask:
  applianceId String?
  appliance   Appliance? @relation(fields: [applianceId], references: [id], onDelete: SetNull)
  sourceKey   String?    @unique
  @@index([applianceId])

model JobBillingHandoff {
  id          String        @id @default(cuid())
  jobId       String
  job         Job           @relation(fields: [jobId], references: [id])
  kind        HandoffKind
  subjectId   String        // agreement id or credit id
  status      HandoffStatus @default(PENDING)
  attempts    Int           @default(0)
  lastError   String?
  doneAt      DateTime?
  createdAt   DateTime      @default(now())
  @@unique([jobId, kind, subjectId])
  @@index([status])
}
```
**Migration `20261003360000_job_results_and_handoff`:** create enums/table/columns; `CREATE UNIQUE INDEX "JobAppliance_one_active_reservation" ON "JobAppliance"("applianceId") WHERE "reservationActive";`
backfill `JobAppliance.role = 'REPLACEMENT'` for the rows `swapReplacementIdsFor` finds today (audit rows with
`reason = 'Swap started'`, `status = 'RESERVED'`, `jobId` = the job; `src/domains/desk-access/index.ts:100-117`); the rest
stay `PRIMARY`. `JobAppliance` rows that already duplicate `(jobId, applianceId)` (if any) are listed by a pre-check query
in the migration notes and de-duplicated by keeping the lowest `id` — if the pre-check finds any, stop and ask.
Existing completed jobs keep `result = NULL` (history is not invented).

**Signatures**
```ts
// src/domains/tasks/index.ts — the existing createTask (line 109) becomes a wrapper
export async function createTaskInTx(tx: Prisma.TransactionClient,
  actor: { userId: string; role: "OWNER" | "ADMIN" | "STAFF" },
  raw: TaskInput & { applianceId?: string | null; sourceKey?: string },
): Promise<{ task: StaffTask; created: boolean }>;     // created=false when sourceKey already exists

// src/domains/jobs/completion.ts (new)
export type JobApplianceResultInput = { applianceId: string; result: JobApplianceResult; note?: string };
export type CompleteJobInput = {
  jobId: string; expectedVersion: number; completionKey: string;
  performedOn: Date | null;                 // Colorado-midnight date, null = scheduled date
  completionNotes: string | null;
  results: readonly JobApplianceResultInput[];
};
export type CompleteJobResult = { jobId: string; outcome: JobOutcome; replayed: boolean; followUpTaskIds: string[]; handoffIds: string[] };
export class JobCompletionConflictError extends Error {}
export async function completeJob(userId: string, input: CompleteJobInput): Promise<CompleteJobResult>;
export async function runPendingHandoffs(limit?: number): Promise<{ done: number; failed: number }>;  // post-commit and nightly sweep
```
**Order inside `completeJob`:** read the job's `agreementId` / `maintenanceRequestId` (no lock) → `assertJobScopeInTx` (P2-E)
→ lock agreement → maintenance request → job (compare `version`, replay check on `completionKey`) → lock the scope's
appliances sorted → validate results cover the scope exactly → for each appliance: status move (conditional), custody
open/close (P2-A), assignment effects → existing in-transaction billing calls with the **positive** ids as `moved` and the
`NOT_DELIVERED` ids as `notDelivered` → follow-up tasks → maintenance resolution (P2-D) → handoff rows → audit
`job.complete` with the results → `Job` update (`status`, `completedAt`, `performedOn`, `outcome`, `completionKey`,
`version + 1`). Post-commit: `runPendingHandoffs`.

### P2-C. Swaps (update item C-03)

**Decisions**
1. **Staging** (`stageSwap`, replacing `startSwapForAppliance`, `inventory/guided-actions.ts:196`) validates and locks both
   sides but moves nothing physical: it **reserves only the replacement** (`AVAILABLE → RESERVED`, `JobAppliance.role =
   REPLACEMENT`, `reservationActive = true`) and creates the SWAP job. The original unit stays `RENTED`, its assignment and
   custody untouched (today both units and the assignment change at staging, `guided-actions.ts:235-262`).
2. Staging requires: original has an open custody episode for the agreement's customer and an open assignment; replacement
   is `AVAILABLE`, same `applianceTypeId`, and not reserved by another job (the partial unique index enforces it).
3. **Completion** (through `completeJob`) is atomic. Valid result pairs: (a) original `RETURNED` + replacement `DELIVERED` —
   close the original's custody (`Swapped out`), open the replacement's, end the original's assignment ("Swapped for
   <asset number>") and create the replacement's on the same rental line, original → `AWAITING_INSPECTION`, replacement
   `RESERVED → RENTED`; (b) both negative — nothing moves, reservation released (replacement back to `AVAILABLE`), job
   `PARTIAL`, one `HIGH` task "Reschedule the swap"; (c) replacement `DELIVERED` + original `NOT_RETURNED` — custody and
   assignment move to the replacement, the original stays `RENTED` with its own open episode and no assignment, `HIGH` task
   "Collect <asset number> from <customer>" (a later removal job covers it because scope is custody-based). **Refused:**
   original `RETURNED` + replacement `NOT_DELIVERED` ("Don't take the old unit unless the new one is delivered").
4. **Cancel** (job cancelled, no-show, agreement ended while staged) releases only a reservation the swap owns: rows with
   `reservationActive = true` for that job, and only if the appliance is still `RESERVED`; then `reservationActive = false`.
5. A swap finds the original's **current** open assignment at completion, whichever agreement it now belongs to, so a renewal
   that started while the swap was staged does not break it. `closeAgreement` cancels a staged swap job for its agreement in
   the same transaction (reason "Agreement ended") and releases its reservation.
6. Lock order is the shared one in section 0 (agreement → job → appliances sorted → pending items). Renewal start, rental
   ending and swap completion all take the agreement lock first, so they serialize. Test: three-way race.
```ts
export async function stageSwap(userId: string, input: { originalApplianceId: string; replacementApplianceId: string; scheduledAt: Date | null }): Promise<{ jobId: string }>;
```
`desk-access` `swapReplacementIdsFor` (`:100`) becomes a display helper reading `JobAppliance.role`; it is no longer an
authorization input (P2-E).

### P2-D. Maintenance chain (update item C-05)

**Decisions**
1. Transaction-capable job creation is `createJobInTx` (P1-A). `scheduleMaintenanceRequest` opens one transaction: users
   (assignee, sorted) → `MaintenanceRequest` row lock → conditional status update (`updateMany ... where status in
   (REVIEWING, IN_PROGRESS)`; REVIEWING → SCHEDULED, an `IN_PROGRESS` request keeps its status for a second visit) →
   `createJobInTx` with `type = MAINTENANCE_VISIT`, the request's customer, service address and appliance → audits. All
   commit together or none do. This keeps Package 1's conditional update (`maintenance/index.ts:76-95`).
2. `MaintenanceRequest.serviceAddressId` (new, nullable) records the property; backfilled when the customer has exactly
   one service address, else `NULL` (the scheduler must pick one).
3. When a request resolves: only when its linked visit job completes with outcome `COMPLETE` (every result `REPAIRED`, or no
   appliance scope) → `RESOLVED`. A `PARTIAL`, `NO_ACCESS`, `NOT_REPAIRED`, no-show or cancelled visit never resolves it:
   it stays `IN_PROGRESS` with a `HIGH` task "Repair not finished", or goes back to `REVIEWING` when it has no other open
   visit job. Starting the visit (`IN_PROGRESS`) moves a `SCHEDULED` request to `IN_PROGRESS`.
4. `ALLOWED_TRANSITIONS` (`maintenance/index.ts:4`) gains `SCHEDULED → REVIEWING` and `IN_PROGRESS → REVIEWING`, used only by the
   system for cancelled/no-show visits.
```ts
export async function scheduleMaintenanceRequest(userId: string, input: {
  requestId: string; scheduledAt: Date; durationMinutes: number | null; assignedToUserId: string | null;
  serviceAddressId: string; confirmedConflictJobIds: readonly string[];
}): Promise<{ jobId: string }>;
```
**Migration `20261003370000_maintenance_links`:** `ALTER TABLE "MaintenanceRequest" ADD COLUMN "serviceAddressId" TEXT` + FK + backfill
`UPDATE ... SET "serviceAddressId" = (SELECT MIN(a."id") FROM "ServiceAddress" a WHERE a."customerId" = "MaintenanceRequest"."customerId" HAVING COUNT(*) = 1)`.

### P2-E. Inspection and job-scoped permissions (update item C-08)

**Decisions: inspection**
1. Each inspection stores the checklist **definition** it was answered against: `checklistDefinition` (array of item texts in
   order) and `checklistVersion`. `BusinessSettings.inspectionChecklistVersion` (new, starts 1) increments whenever the owner
   saves the list (`inspectionChecklist`, schema line 1448). The record can always be rebuilt.
2. `recordApplianceInspection` (`guided-actions.ts:320`) takes `expectedChecklistVersion` and `answers: boolean[]`
   (one per definition item). A stale version throws `ChecklistVersionError` ("The checklist changed; reload"). `passed` is
   **derived on the server**: all answers true. Anything else is a fail → `MAINTENANCE`.
3. A pass with unchecked items is an **override**: OWNER/ADMIN only, requires `overrideReason`, stores
   `overriddenByUserId` and `overrideReason`, and writes audit `inspection.override`. STAFF cannot override.
4. Completed inspections, job checklists and part movements are immutable: no update/delete functions exist, a trigger blocks
   UPDATE/DELETE on `ApplianceInspection`, and `updateJobChecklist` rejects a job that is `COMPLETED` or `CANCELLED`.
   Corrections append an `ApplianceInspectionAmendment` (note + author) and never change the original.
```prisma
// add to ApplianceInspection:
  checklistDefinition Json     @default("[]")
  checklistVersion    Int      @default(0)
  jobId               String?
  overrideReason      String?
  overriddenByUserId  String?
  amendments          ApplianceInspectionAmendment[]
model ApplianceInspectionAmendment {
  id String @id @default(cuid()); inspectionId String; inspection ApplianceInspection @relation(fields: [inspectionId], references: [id])
  note String; createdByUserId String; createdAt DateTime @default(now())
  @@index([inspectionId])
}
// add to BusinessSettings:  inspectionChecklistVersion Int @default(1)
```
**Migration `20261003380000_inspection_snapshot`:** columns + table; backfill existing rows' `checklistDefinition` from their own
`checklist` item texts (`jsonb_agg(elem->>'item')`), `checklistVersion = 0`; then add the append-only trigger as for parts.

**Decisions: job-scoped STAFF authority.** One helper, called inside each domain write's own transaction after the actor check:
```ts
export async function assertJobScopeInTx(tx: Prisma.TransactionClient,
  actor: { userId: string; role: TeamRole },
  args: { jobId: string; applianceId?: string; write: "COMPLETE" | "STATUS" | "PHOTO" | "CHECKLIST" | "INSPECTION" | "SWAP_STATUS" },
): Promise<{ jobId: string; status: JobStatus; type: JobType; assignedToUserId: string | null }>;
```
OWNER/ADMIN pass. STAFF pass only if: the job is `SCHEDULED`/`IN_PROGRESS` (photos also `COMPLETED`), it is assigned to them (or unassigned **and**
`BusinessSettings.staffMayWorkUnassignedJobs` is true, new setting, starting value true so today's behavior is kept), and
when `applianceId` is given, a `JobAppliance` row links it. Every one of these writes calls it in its own transaction (the
checks currently happen outside it, e.g. `src/app/desk/jobs/actions.ts:247`): `completeJob`, `updateJobStatus`, the bulk status
action, `addJobPhoto` (`jobs/index.ts:475`), `updateJobChecklist` (`:568`), `recordApplianceInspection`,
`updateApplianceStatusAsTeamActor` (guided/job-originated status change), swap cancellation. `setJobRepairCosts` (`:499`),
`stageSwap`, `scheduleJob`, `scheduleMaintenanceRequest` are OWNER/ADMIN only. New setting text: "Can staff work jobs nobody is
assigned to? On: any staff member can open and finish an unassigned job. Off: only jobs assigned to them. Starting value: on."

### P2-F. Earnings correction (update item C-10)

`collectedBetween` (`src/domains/billing/collected.ts:25`) is customer cash. Today nothing in `src/` imports it (checked),
and appliance revenue is estimated by splitting a rental line's `monthlyPriceCents` evenly across the appliances on the line
(`src/domains/inventory/analytics.ts`, `AssignmentPeriod.applianceCountOnLine`). Decision until a real allocation method is
designed: appliance screens keep showing that estimate, **labelled "Estimated rent (line price split evenly)"**; customer-level
cash lives only on the customer page under "Cash received from this customer". A test fails if an appliance/fleet module
imports `collectedBetween`. Repair and parts costs on appliance screens are the actuals (`jobPartsCost`, P1-C).

## Section 8 — items missing from the first delivery: what happens to the Stripe subscription (Chris, 2026-10-03; decided)

Built already (PR #165): `PendingDelivery`, the late-delivery credit, the never-delivered credit
(`removeUndeliveredItem`, `src/domains/billing/pickup-billing-events.ts:456`). Not redesigned here.

1. **Delivered late** (the same appliance on a later delivery job): the line stays on the subscription; the credit is the whole
   remedy. No provider operation is created.
2. **Swapped for the same type**: the line stays. Staging (`substituteWaitingItem(userId, { pendingDeliveryId, replacementApplianceId, deliveryJobId })`,
   OWNER/ADMIN) validates: item still waiting (`deliveredOn` and `removedAt` null), replacement `AVAILABLE`, **same
   `ApplianceTypeId` as the waiting appliance** (a different type is refused with "Different type: ask the owner", never
   automatic), job is a `SCHEDULED`/`IN_PROGRESS` delivery for the same agreement. It reserves the replacement
   (`reservationActive`) and sets `JobAppliance.fulfilsPendingDeliveryId` and `PendingDelivery.substituteApplianceId`.
   On completion with the replacement `DELIVERED`: the original's assignment ends ("Replaced by <asset>"), the original goes
   `RESERVED → AVAILABLE`, the replacement gets an assignment on the same line, custody opens for the replacement, and
   `recordLateDeliveries` (`pickup-billing-events.ts:352`) matches waiting rows by `applianceId IN delivered OR
   substituteApplianceId IN delivered`, so the credit counts to the **replacement's delivery date** exactly as for a late delivery.
   Cancelling or a `NOT_DELIVERED` result releases only the reservation this job owns and clears `substituteApplianceId`.
3. **Permanently cancelled** (`removeUndeliveredItem`): everything billed is credited (built) **and** the item comes off Stripe.
   - New table `RentalLineAmendment` (append-only; trigger as for parts): `id, rentalLineId, pendingDeliveryId @unique,
     previousMonthlyPriceCents, newMonthlyPriceCents, effectiveFrom (first day of the next billing period, `billingPeriodFor`), reason, createdByUserId, createdAt`.
   - In the same transaction as the credit: append the amendment and set `RentalLine.monthlyPriceCents` to the new price. The
     signed price stays visible as `previousMonthlyPriceCents` and in the signature snapshot; the 40 files that read
     `monthlyPriceCents` therefore show the reduced rent with no change. `itemsForAppliances`
     (`pickup-billing-events.ts:114-152`) must count only appliances with an **open assignment** when it splits a line price
     (today it counts every appliance ever assigned, which would shrink the remaining items' shares after a removal) — required change with a test.
   - The monthly share removed is `itemMonthlyPriceCents(linePrice, applianceCount, index)` computed before the unassign.
   - Durable `SUBSCRIPTION_UPDATE` provider operation, key `subscription-line-reduce-<pendingDeliveryId>`, `subjectType =
     "RentalLine"`, `subjectId = rentalLineId`, claimed in the same transaction; called after commit; completed with SUCCEEDED/FAILED/UNKNOWN like `syncTerminationEnd` (`subscription-term.ts`). The call finds the subscription item by listing the
     subscription's items and matching `price.product.metadata.rentalLineId` (set at `billing/checkout.ts:521-529`), then
     `subscriptions.update(subscriptionId, { proration_behavior: "none", items: [{ id, price_data: { currency: "usd", product, unit_amount: newAmount, recurring: { interval: "month" } } }] })`
     keeping the item's tax rates; if the line has no appliances left, `items: [{ id, deleted: true }]`. Retries use `stripeKeyForAttempt`.
   - Reconciliation: `reconcileSubscriptionUpdate` (`billing/reconciliation.ts:237`) gains `parseLineReduceKey` and a
     `desiredLineAmount` that reads the line's current local price; if Stripe's item already matches, the operation is marked SUCCEEDED, otherwise it retries; a failure stays visible in the drift workbench as a mismatch.
   - Owner view while pending/failed: the item shows as "Cancelled — Stripe update pending" on Today until the operation is SUCCEEDED; the audit entry `agreement.item_cancelled` records the amendment id and operation id.
   - **Every item cancelled:** if no appliance on the agreement has an open assignment after the removal, no reduction is made; the same transaction ends the agreement through `closeAgreementInTx` (a required extraction from `closeAgreement`, `agreements/index.ts:569`, returning the post-commit Stripe continuation). It is `CANCELLED` when nothing on it was ever delivered, `ENDED` otherwise. `removeUndeliveredItem` is reordered to the shared lock order (read pending → lock agreement → pending → appliances).
   - Owner/admin only, as today.
```prisma
model RentalLineAmendment {
  id                        String     @id @default(cuid())
  rentalLineId              String
  rentalLine                RentalLine @relation(fields: [rentalLineId], references: [id])
  pendingDeliveryId         String     @unique
  previousMonthlyPriceCents Int
  newMonthlyPriceCents      Int
  effectiveFrom             DateTime
  reason                    String
  createdByUserId           String
  createdAt                 DateTime   @default(now())
  @@index([rentalLineId])
}
// add to PendingDelivery: substituteApplianceId String?
// add to RentalLine: amendments RentalLineAmendment[]
```
Migration `20261003390000_line_amendments_and_substitution` (structure + the `substituteApplianceId` column + append-only trigger).
Tests to add: see section 10 (S1–S6).

## Section 9 — C-09 pickup/return billing: interface only (BLOCKED)

Batch C needs one function from the shared billing contract and may not decide anything else:
```ts
export interface SharedBillingEndContract {
  recordPhysicalReturnInTx(tx: Prisma.TransactionClient, input: {
    agreementId: string; applianceIds: readonly string[]; returnedOn: Date; jobId: string;
    cause: "CUSTOMER" | "COMPANY" | "UNDECIDED";
  }): Promise<{ billingEndsOn: Date | null; handoffId: string | null }>;
}
```
Batch C must not: call Stripe directly, add a second subscription-ending process (all ending goes through `closeAgreement` /
`closeAgreementInTx`), add or repeat an early-termination fee, or decide who was at fault. `cause` is always `UNDECIDED` until
Chris answers IN-24's open part (who records that a late pickup was the company's fault, and how waived days show on the
statement). The customer-caused late-return charge that exists today keeps working unchanged.

## Section 10 — named tests (real Postgres for every concurrency or rollback case)

Scheduling: `schedule-half-open-back-to-back-ok`; `schedule-detects-job-crossing-midnight-from-previous-denver-day`;
`schedule-spring-forward-2026-03-08` / `schedule-fall-back-2026-11-01`; `schedule-two-concurrent-jobs-same-person-one-wins` (real
Postgres); `schedule-reassign-locks-both-people-in-id-order-no-deadlock`; `schedule-stale-confirmation-cannot-approve-new-conflict`;
`schedule-stale-version-rejected`; `schedule-null-duration-uses-owner-default`; `no-show-clears-schedule-leaves-custody-inventory-billing`.
Asset numbers: `asset-concurrent-creates-distinct`; `asset-two-types-same-prefix-share-counter`; `asset-missing-counter-seeded-from-nonstandard`;
`asset-failure-midway-rolls-back-counter-and-units`; `asset-never-reuses-gap`; `asset-hand-made-number-skipped`.
Parts: `parts-usage-over-stock-refused-not-clamped`; `parts-retry-same-key-same-payload-returns-first`; `parts-same-key-different-payload-conflict`;
`parts-two-partial-receipts-both-apply`; `parts-multi-part-command-locks-sorted-no-deadlock`; `parts-opening-balance-not-replayed-from-received-orders`;
`parts-stored-total-equals-movement-sum`; `parts-null-vs-zero-cost`; `parts-itemized-and-legacy-cost-not-double-counted`; `parts-movement-update-delete-blocked-by-trigger`;
`parts-archive-keeps-history`; `parts-delete-refused-when-history`.
Custody: `custody-one-open-per-appliance-db-rule`; `custody-survives-renewal-start`; `custody-survives-close-agreement-null-user`;
`custody-backfill-uses-job-evidence`; `custody-backfill-never-copies-reservation-time`; `custody-backfill-swapped-out-unit-has-no-open-episode`; `custody-status-invariant`.
Completion: `complete-requires-result-per-appliance`; `complete-retry-same-key-no-second-task-audit-credit`; `complete-negative-result-makes-one-HIGH-task`;
`complete-move-conflict-aborts-all`; `complete-handoff-row-written-in-same-transaction`; `bulk-complete-refused`; `complete-rolls-back-on-billing-error`.
Swaps: `swap-stage-moves-nothing-but-reserves-replacement`; `swap-complete-atomic-custody-and-assignment`; `swap-original-returned-replacement-not-delivered-refused`;
`swap-replacement-delivered-original-not-returned-keeps-open-episode-and-task`; `swap-cancel-releases-only-own-reservation`; `swap-renewal-start-agreement-end-completion-three-way-race`.
Maintenance: `maintenance-schedule-atomic-rolls-back-together`; `maintenance-resolves-only-on-complete-outcome`; `maintenance-partial-noshow-cancel-never-resolve`.
Inspection and permissions: `inspection-stale-checklist-version-rejected`; `inspection-pass-derived-on-server`; `inspection-staff-override-forbidden`; `inspection-owner-override-audited`;
`inspection-update-delete-blocked`; `staff-write-rechecked-inside-transaction-for-each-listed-write`; `staff-unassigned-job-follows-setting`.
Earnings: `appliance-modules-never-import-collectedBetween`; `appliance-estimate-labelled`.
Subscription rule: S1 `late-delivery-leaves-subscription-unchanged`; S2 `same-type-swap-leaves-subscription-unchanged-and-credits-to-replacement-date`; S2b `different-type-substitute-refused`;
S3 `cancel-reduces-exactly-one-subscription-item-once-and-retry-is-noop`; S4 `stripe-failure-leaves-visible-pending-operation`; S5 `drift-shows-mismatch-until-stripe-matches`;
S6 `all-items-cancelled-ends-agreement-through-closeAgreement`; S7 `remaining-item-share-after-removal-uses-open-assignments-only`; S8 `amendment-preserves-signed-price-history`.
Housekeeping: backup export contains every new table; `docs/DATABASE.md` lists them; `check-migrations.mjs` passes; every new setting appears on its screen.

## Section 11 — stop-and-ask list (the implementer stops and writes to Chris; do not guess)

1. The migration checker flags any statement here (CHECK, trigger, partial index, `NOT NULL DEFAULT`).
2. The duplicate `JobAppliance (jobId, applianceId)` pre-check finds rows, or the custody backfill leaves more than a handful of appliances in `findCustodyGaps`.
3. A different appliance **type** is offered for a waiting item (owner decision on price and agreement change).
4. Anything about who is at fault for a late pickup or how waived days appear (IN-24 open part), or any early-termination fee change.
5. A change that would call Stripe outside the durable provider-operation path.
6. Production data must be rewritten (not just added to).
7. The design is silent on a state or permission the code hits.

## Section 12 — work order and approval status per slice

| Order | Slice | Migrations | Recommended state |
|---|---|---|---|
| 1 | P1-A Scheduling | `…290000` | Ready for Chris's approval (no billing) |
| 2 | P1-B Asset numbers | `…300000` | Ready for Chris's approval (no billing) |
| 3 | P1-C Parts ledger + archival | `…310000`–`…333000` | Ready for Chris's approval (no billing) |
| 4 | P2-A Custody | `…340000`, `…350000` | Ready for Chris's approval (reads no billing) |
| 5 | P2-B Completion, results, tasks, handoff rows | `…360000` | Ready except executing handoffs through the shared billing contract (blocked; the existing post-commit calls stay) |
| 6 | P2-C Swaps | (in `…360000`/`…390000`) | Ready for Chris's approval after P2-A and P2-B |
| 7 | P2-D Maintenance chain | `…370000` | Ready for Chris's approval after P1-A |
| 8 | P2-E Inspection + job-scoped permissions | `…380000` | Ready for Chris's approval |
| 9 | P2-F Earnings correction | none | Ready for Chris's approval |
| 10 | Section 8 Missing-item subscription rule | `…390000` | Ready for Chris's approval (decided by Chris 2026-10-03); needs P2-B and `closeAgreementInTx` |
| — | Section 9 C-09 pickup/return billing | — | **BLOCKED**: shared billing contract + IN-24 company-fault answer |

Suggested PR stack: (1) P1-A+P1-B, (2) P1-C, (3) P2-A+P2-B, (4) P2-C+P2-D, (5) P2-E+P2-F, (6) section 8.
