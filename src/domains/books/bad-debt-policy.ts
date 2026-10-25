import type { Prisma } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * IN-39: whether a written-off bill's sales tax is taken back as a bad-debt deduction (Batch K: the poster only
 * debits sales tax payable when this is "YES"; "UNDECIDED" stops posting a write-off with tax).
 */
export const BAD_DEBT_TAX_RECOVERY_VALUES = ["UNDECIDED", "YES", "NO"] as const;

export function badDebtTaxRecoveryProblem(value: unknown): string | null {
  return typeof value === "string" && (BAD_DEBT_TAX_RECOVERY_VALUES as readonly string[]).includes(value)
    ? null : "That answer isn't one this setting accepts.";
}

/** Owner only, settings row locked, audited. Runs inside the caller's transaction (Decisions & reviews). */
export async function saveBadDebtTaxRecoveryInTx(
  tx: Prisma.TransactionClient, actorId: string, value: string,
): Promise<void> {
  const problem = badDebtTaxRecoveryProblem(value);
  if (problem || value === "UNDECIDED") throw new Error(problem ?? "Choose yes or no.");
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
  const before = await tx.businessSettings.findUniqueOrThrow({
    where: { id: "singleton" }, select: { badDebtTaxRecovery: true },
  });
  await tx.businessSettings.update({ where: { id: "singleton" }, data: { badDebtTaxRecovery: value } });
  await tx.auditLog.create({
    data: { userId: actorId, action: "books.bad_debt_tax_recovery.update",
      entityType: "BusinessSettings", entityId: "singleton",
      oldValue: { badDebtTaxRecovery: before.badDebtTaxRecovery }, newValue: { badDebtTaxRecovery: value } },
  });
}
