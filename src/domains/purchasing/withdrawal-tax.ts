import type { PartStockMovement, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PurchaseTaxContextPendingError, recordUseTaxForPurchase } from "@/domains/tax/use-tax";

/**
 * Batch M (design D-M2). Stock bought for resale owes no tax when it arrives. When some of it is taken out for the
 * business's own use (a repair, an installation, given away, lost), Colorado treats that as a use, so use tax is
 * recorded on the cost of the resale units that left. One row per movement: `sourceType PART_WITHDRAWAL`,
 * `sourceId` = the movement id. Tax-paid units never owe it. Undoing the movement cancels the row (or opens the
 * normal amendment when its return is already filed).
 */

type Tx = Prisma.TransactionClient;

/** The movement kinds that count as the owner using up resale stock (a sale is not a use). */
export const WITHDRAWAL_KINDS: ReadonlySet<string> = new Set(["USAGE", "ADJUSTMENT", "RECOUNT"]);

export const WITHDRAWAL_SOURCE = "PART_WITHDRAWAL" as const;

/** Record use tax for a movement that took resale units. Returns PENDING when tax setup isn't ready yet. */
export async function recordWithdrawalUseTaxInTx(
  tx: Tx,
  movement: Pick<PartStockMovement, "id" | "createdAt" | "resaleCostCents">,
): Promise<"RECORDED" | "PENDING" | "NOTHING_OWED"> {
  const amountCents = -movement.resaleCostCents;
  if (amountCents <= 0) return "NOTHING_OWED"; // unknown cost: nothing to tax until the cost is known
  try {
    await recordUseTaxForPurchase(
      tx,
      {
        sourceType: WITHDRAWAL_SOURCE, sourceId: movement.id, purchasedOn: movement.createdAt,
        amountCents, vendorTaxCents: 0, isRentalInventory: false,
      },
      { allowAuditedFiledCorrection: true },
    );
    return "RECORDED";
  } catch (error) {
    if (error instanceof PurchaseTaxContextPendingError) return "PENDING";
    throw error;
  }
}

/** An undone withdrawal owes nothing. Rows already on a filed return are corrected through the amendment path. */
export async function cancelWithdrawalUseTaxInTx(tx: Tx, movementId: string): Promise<void> {
  const rows = await tx.purchaseUseTax.findMany({ where: { sourceType: WITHDRAWAL_SOURCE, sourceId: movementId }, select: { id: true, status: true, purchasedOn: true } });
  if (rows.length === 0) return;
  try {
    await recordUseTaxForPurchase(
      tx,
      { sourceType: WITHDRAWAL_SOURCE, sourceId: movementId, purchasedOn: rows[0]!.purchasedOn, amountCents: 0, vendorTaxCents: 0, isRentalInventory: false },
      { allowAuditedFiledCorrection: true },
    );
  } catch (error) {
    if (!(error instanceof PurchaseTaxContextPendingError)) throw error;
    if (rows.some((row) => row.status === "FILED")) {
      throw new Error("This use was already reported on a filed tax return. Finish the tax setup first, then undo it.");
    }
    await tx.purchaseUseTax.updateMany({
      where: { sourceType: WITHDRAWAL_SOURCE, sourceId: movementId },
      data: { purchaseAmountCents: 0, useTaxDueCents: 0, status: "NOT_DUE" },
    });
  }
}

type PendingRow = { id: string; createdAt: Date; resaleCostCents: number };

/** Movements that took resale units, are not undone, and have no use-tax row yet. */
async function pendingWithdrawals(client: Tx | typeof prisma, limit: number): Promise<PendingRow[]> {
  return client.$queryRaw<PendingRow[]>`
    SELECT m."id", m."createdAt", m."resaleCostCents"
    FROM "PartStockMovement" m
    WHERE m."kind" IN ('USAGE', 'ADJUSTMENT', 'RECOUNT')
      AND m."resaleCostCents" < 0
      AND NOT EXISTS (SELECT 1 FROM "PartStockMovement" r WHERE r."reversesMovementId" = m."id")
      AND NOT EXISTS (SELECT 1 FROM "PurchaseUseTax" t WHERE t."sourceType" = 'PART_WITHDRAWAL' AND t."sourceId" = m."id")
    ORDER BY m."createdAt" ASC, m."id" ASC
    LIMIT ${limit}
  `;
}

export async function countPendingWithdrawalUseTax(client: Tx | typeof prisma = prisma): Promise<{ count: number; oldest: Date | null }> {
  const rows = await pendingWithdrawals(client, 500);
  return { count: rows.length, oldest: rows[0]?.createdAt ?? null };
}

/** Daily catch-up: record the use tax that was waiting on tax setup. Each movement is its own transaction. */
export async function recordPendingWithdrawalUseTax(limit = 200): Promise<{ checked: number; recorded: number; stillPending: number }> {
  const rows = await pendingWithdrawals(prisma, limit);
  let recorded = 0;
  let stillPending = 0;
  for (const row of rows) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const fresh = await pendingWithdrawals(tx, 500);
        const mine = fresh.find((r) => r.id === row.id);
        if (!mine) return "SKIPPED" as const;
        return recordWithdrawalUseTaxInTx(tx, mine);
      });
      if (result === "RECORDED") recorded++;
      else if (result === "PENDING") stillPending++;
    } catch (error) {
      stillPending++;
      console.error("[tax] withdrawal catch-up failed", row.id, error instanceof Error ? error.message : "unknown error");
    }
  }
  return { checked: rows.length, recorded, stillPending };
}
