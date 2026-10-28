import type { Prisma } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * IN-79: the research-based planning treatment of the administrative setup fee (`setupFeeTaxPlanningTreatment`). It is
 * separate from the CPA-confirmed `setupFeeTaxTreatment`, which stays behind its own approval (Settings › Signing
 * charges): changing the planning value never bypasses that review.
 */
export const SETUP_TAX_PLANNING_VALUES = ["TAXABLE", "NOT_TAXABLE"] as const;
/** `BusinessSettings.setupFeeTaxTreatment` — the CPA-confirmed value (see setup-tax-approval.ts). */
export const SETUP_TAX_TREATMENT_VALUES = ["UNDECIDED", "TAXABLE", "NOT_TAXABLE"] as const;

export function setupTaxPlanningProblem(value: unknown): string | null {
  return typeof value === "string" && (SETUP_TAX_PLANNING_VALUES as readonly string[]).includes(value)
    ? null : "Choose a valid provisional tax planning setting.";
}

/** Owner only, settings row locked, audited like the Signing charges save. Runs inside the caller's transaction. */
export async function saveSetupTaxPlanningInTx(
  tx: Prisma.TransactionClient, actorId: string, value: string,
  professionalAnswer = false,
): Promise<void> {
  const problem = setupTaxPlanningProblem(value);
  if (problem) throw new Error(problem);
  // ACCT-1: accountant only as a CPA professional answer through Decisions & reviews.
  await assertActiveTeamActor(tx, actorId, professionalAnswer ? ["ACCOUNTANT"] : ["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
  const before = await tx.businessSettings.findUniqueOrThrow({
    where: { id: "singleton" }, select: { setupFeeTaxPlanningTreatment: true },
  });
  await tx.businessSettings.update({ where: { id: "singleton" }, data: { setupFeeTaxPlanningTreatment: value } });
  await tx.auditLog.create({
    data: { userId: actorId, action: "settings.signing_charges.update",
      entityType: "BusinessSettings", entityId: "singleton",
      oldValue: { planningTreatment: before.setupFeeTaxPlanningTreatment },
      newValue: { planningTreatment: value, via: "decisions" } },
  });
}
