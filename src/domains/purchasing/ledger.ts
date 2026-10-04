import { createHash } from "node:crypto";
import type { PartStockMovement, Prisma, PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Parts ledger (Batch C, slice P1-C). Every change to PartRecord.quantityOnHand goes through
// applyPartMovementsInTx: one append-only PartStockMovement row per change, the stored total
// kept equal to the sum of a part's rows. Using more than is on hand is refused, never clamped.
// A request is identified by its operationKey: a retry with the same key and the same request
// returns the first result and changes nothing; the same key with a different request is refused.
// Lock order (spec section 0): PartRecord rows sorted by id.
// ---------------------------------------------------------------------------

export class InsufficientStockError extends Error {
  constructor(readonly onHand: number) {
    super(`Only ${onHand} on hand. Recount first if the shelf count is wrong.`);
    this.name = "InsufficientStockError";
  }
}

export class PartOperationConflictError extends Error {
  constructor() {
    super("That request was already used for a different change. Reload the page and try again.");
    this.name = "PartOperationConflictError";
  }
}

export type PartMovementRequest = {
  partRecordId: string;
  kind: "RECEIPT" | "USAGE" | "ADJUSTMENT" | "RECOUNT" | "REVERSAL";
  /** RECEIPT: positive. USAGE: negative. ADJUSTMENT: signed, non-zero. Ignored for RECOUNT and REVERSAL. */
  quantityDelta?: number;
  /** RECOUNT only: the shelf count; the change is worked out under the lock. */
  countedQuantity?: number;
  /** null = unknown; 0 only when the owner entered 0. */
  unitCostCents: number | null;
  purchaseOrderLineItemId?: string;
  jobId?: string;
  reversesMovementId?: string;
  reason?: string;
};

export const OPERATION_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,100}$/;
const MAX_REQUESTS = 100;

function canonical(requests: readonly PartMovementRequest[]): string {
  const rows = [...requests]
    .map((r) => ({
      partRecordId: r.partRecordId,
      kind: r.kind,
      quantityDelta: r.quantityDelta ?? null,
      countedQuantity: r.countedQuantity ?? null,
      unitCostCents: r.unitCostCents,
      purchaseOrderLineItemId: r.purchaseOrderLineItemId ?? null,
      jobId: r.jobId ?? null,
      reversesMovementId: r.reversesMovementId ?? null,
      reason: r.reason ?? null,
    }))
    .sort((a, b) => (a.partRecordId < b.partRecordId ? -1 : a.partRecordId > b.partRecordId ? 1 : 0));
  return JSON.stringify(rows);
}

export function payloadHashOf(requests: readonly PartMovementRequest[]): string {
  return createHash("sha256").update(canonical(requests)).digest("hex");
}

function validateRequests(operationKey: string, requests: readonly PartMovementRequest[]) {
  if (!OPERATION_KEY_PATTERN.test(operationKey)) {
    throw new Error("This request has no valid identity. Reload the page and try again.");
  }
  if (requests.length < 1 || requests.length > MAX_REQUESTS) throw new Error("Nothing to record.");
  const seen = new Set<string>();
  for (const r of requests) {
    if (seen.has(r.partRecordId)) throw new Error("A part can appear only once in one stock change.");
    seen.add(r.partRecordId);
    if (r.unitCostCents !== null && (!Number.isSafeInteger(r.unitCostCents) || r.unitCostCents < 0)) {
      throw new Error("A part cost must be a whole number of cents, or left blank when unknown.");
    }
    switch (r.kind) {
      case "RECEIPT":
        if (!Number.isSafeInteger(r.quantityDelta) || (r.quantityDelta as number) < 1) throw new Error("A received quantity must be at least 1.");
        break;
      case "USAGE":
        if (!Number.isSafeInteger(r.quantityDelta) || (r.quantityDelta as number) > -1) throw new Error("Enter how many were used.");
        break;
      case "ADJUSTMENT":
        if (!Number.isSafeInteger(r.quantityDelta) || r.quantityDelta === 0) throw new Error("An adjustment must change the count.");
        break;
      case "RECOUNT":
        if (!Number.isSafeInteger(r.countedQuantity) || (r.countedQuantity as number) < 0) throw new Error("Quantity on hand can't be negative.");
        break;
      case "REVERSAL":
        if (!r.reversesMovementId) throw new Error("Choose the movement to reverse.");
        break;
    }
  }
}

type Existing = Array<{ partRecordId: string; payloadHash: string }>;

async function replayIfAny(
  tx: Prisma.TransactionClient,
  operationKey: string,
  partIds: string[],
  hash: string,
): Promise<PartStockMovement[] | null> {
  const rows = await tx.partStockMovement.findMany({
    where: { operationKey, partRecordId: { in: partIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return null;
  const existing: Existing = rows;
  // A RECOUNT that changed nothing writes no row, so a replay may legitimately find fewer rows than parts.
  if (existing.some((row) => row.payloadHash !== hash)) throw new PartOperationConflictError();
  return rows;
}

/** Lock the parts (sorted by id) for the rest of the transaction. */
export async function lockPartRecords(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "PartRecord" WHERE "id" = ANY(${sorted}) ORDER BY "id" FOR UPDATE
  `;
  if (rows.length !== sorted.length) throw new Error("Couldn't find that part.");
}

export async function applyPartMovementsInTx(
  tx: Prisma.TransactionClient,
  actorUserId: string | null,
  operationKey: string,
  requests: readonly PartMovementRequest[],
): Promise<{ movements: PartStockMovement[]; replayed: boolean }> {
  validateRequests(operationKey, requests);
  const partIds = requests.map((r) => r.partRecordId);
  const hash = payloadHashOf(requests);

  const early = await replayIfAny(tx, operationKey, partIds, hash);
  if (early) return { movements: early, replayed: true };

  await lockPartRecords(tx, partIds);
  const again = await replayIfAny(tx, operationKey, partIds, hash);
  if (again) return { movements: again, replayed: true };

  const parts = await tx.partRecord.findMany({
    where: { id: { in: partIds } },
    select: { id: true, quantityOnHand: true, archivedAt: true },
  });
  const partById = new Map(parts.map((p) => [p.id, p]));

  const movements: PartStockMovement[] = [];
  for (const request of [...requests].sort((a, b) => (a.partRecordId < b.partRecordId ? -1 : 1))) {
    const part = partById.get(request.partRecordId)!;
    const balance = part.quantityOnHand;
    let delta: number;
    let reversesMovementId: string | null = null;
    let jobId = request.jobId ?? null;
    let purchaseOrderLineItemId = request.purchaseOrderLineItemId ?? null;
    let unitCostCents = request.unitCostCents;

    if (request.kind === "USAGE" && part.archivedAt) {
      throw new Error("This part is archived. Restore it before recording use.");
    }

    if (request.kind === "RECOUNT") {
      delta = (request.countedQuantity as number) - balance;
      if (delta === 0) continue; // nothing changed, nothing to record
    } else if (request.kind === "REVERSAL") {
      const original = await tx.partStockMovement.findUnique({ where: { id: request.reversesMovementId! } });
      if (!original || original.partRecordId !== request.partRecordId) throw new Error("Couldn't find the movement to reverse.");
      if (original.kind === "REVERSAL") throw new Error("A reversal cannot itself be reversed; record a new correction instead.");
      const already = await tx.partStockMovement.findUnique({ where: { reversesMovementId: original.id }, select: { id: true } });
      if (already) throw new Error("That movement was already reversed.");
      delta = -original.quantityDelta;
      reversesMovementId = original.id;
      jobId = original.jobId;
      purchaseOrderLineItemId = original.purchaseOrderLineItemId;
      unitCostCents = original.unitCostCents;
    } else {
      delta = request.quantityDelta as number;
    }

    const balanceAfter = balance + delta;
    if (balanceAfter < 0) throw new InsufficientStockError(balance);

    movements.push(
      await tx.partStockMovement.create({
        data: {
          partRecordId: request.partRecordId,
          kind: request.kind,
          quantityDelta: delta,
          balanceAfter,
          unitCostCents,
          operationKey,
          payloadHash: hash,
          purchaseOrderLineItemId,
          jobId,
          reversesMovementId,
          reason: request.reason?.trim() ? request.reason.trim().slice(0, 500) : null,
          createdByUserId: actorUserId,
        },
      }),
    );
    partById.set(part.id, { ...part, quantityOnHand: balanceAfter });
    await tx.partRecord.update({ where: { id: part.id }, data: { quantityOnHand: balanceAfter } });
  }

  if (movements.length > 0) {
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "part.movement",
        entityType: "PartStockOperation",
        entityId: operationKey,
        newValue: {
          movementIds: movements.map((m) => m.id),
          kinds: movements.map((m) => m.kind),
          partRecordIds: movements.map((m) => m.partRecordId),
        },
      },
    });
  }
  return { movements, replayed: false };
}

/** The most recent receipt cost known for a part, used to label a usage as an estimate. */
export async function lastKnownPurchaseCostCents(tx: Prisma.TransactionClient, partRecordId: string): Promise<number | null> {
  const row = await tx.partStockMovement.findFirst({
    where: { partRecordId, kind: "RECEIPT", unitCostCents: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { unitCostCents: true },
  });
  return row?.unitCostCents ?? null;
}

export type JobPartsCost = { source: "ITEMIZED" | "LEGACY" | "NONE"; cents: number | null; unknownCostLines: number };

type Reader = Prisma.TransactionClient | PrismaClient;

/**
 * What a job's parts cost. If the job has any itemized USAGE movement, the cost is the sum of those
 * movements' known costs (reversed ones removed) and the hand-entered `partsCostCents` is ignored;
 * otherwise the legacy hand-entered number is used. Derived on read; never written back.
 */
export async function jobPartsCosts(client: Reader, jobIds: readonly string[]): Promise<Map<string, JobPartsCost>> {
  const result = new Map<string, JobPartsCost>();
  if (jobIds.length === 0) return result;
  const [jobs, movements] = await Promise.all([
    client.job.findMany({ where: { id: { in: [...jobIds] } }, select: { id: true, partsCostCents: true } }),
    client.partStockMovement.findMany({
      where: { jobId: { in: [...jobIds] }, kind: { in: ["USAGE", "REVERSAL"] } },
      select: { id: true, jobId: true, kind: true, quantityDelta: true, unitCostCents: true, reversesMovementId: true },
    }),
  ]);
  const reversed = new Set(movements.filter((m) => m.kind === "REVERSAL").map((m) => m.reversesMovementId));
  for (const job of jobs) {
    const usage = movements.filter((m) => m.jobId === job.id && m.kind === "USAGE");
    if (usage.length === 0) {
      result.set(job.id, job.partsCostCents === null ? { source: "NONE", cents: null, unknownCostLines: 0 } : { source: "LEGACY", cents: job.partsCostCents, unknownCostLines: 0 });
      continue;
    }
    let cents = 0;
    let unknown = 0;
    for (const m of usage) {
      if (reversed.has(m.id)) continue;
      if (m.unitCostCents === null) unknown += 1;
      else cents += -m.quantityDelta * m.unitCostCents;
    }
    result.set(job.id, { source: "ITEMIZED", cents, unknownCostLines: unknown });
  }
  return result;
}

export async function jobPartsCost(client: Reader, jobId: string): Promise<JobPartsCost> {
  return (await jobPartsCosts(client, [jobId])).get(jobId) ?? { source: "NONE", cents: null, unknownCostLines: 0 };
}

/** Parts whose stored total differs from the sum of their movements (should always be empty). */
export async function findPartLedgerMismatches(
  client: Reader,
  onlyPartRecordIds?: readonly string[],
): Promise<Array<{ partRecordId: string; stored: number; summed: number }>> {
  const ids = onlyPartRecordIds ? [...onlyPartRecordIds] : null;
  const rows = await client.$queryRaw<Array<{ partRecordId: string; stored: number; summed: number }>>`
    SELECT p."id" AS "partRecordId", p."quantityOnHand"::int AS "stored", COALESCE(SUM(m."quantityDelta"), 0)::int AS "summed"
    FROM "PartRecord" p
    LEFT JOIN "PartStockMovement" m ON m."partRecordId" = p."id"
    WHERE (${ids}::text[] IS NULL OR p."id" = ANY(${ids}::text[]))
    GROUP BY p."id", p."quantityOnHand"
    HAVING p."quantityOnHand" <> COALESCE(SUM(m."quantityDelta"), 0)
  `;
  return rows;
}
