import type { Prisma, RdfHandling, ShortTermLeaseElection, TaxReportingBasis } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { reportingBasisProblem, taxPolicyValueProblem, type TaxPolicyField } from "./policy-values";

/**
 * One-setting tax policy saves for Decisions & reviews (DEC-1a). They run inside the caller's transaction and do what
 * the Tax setup save (`saveTaxSettings`) does for that one field: owner only, settings row locked, audited with the
 * same action name. They never touch the business address or rates. The caller runs `afterTaxPolicyChange` after the
 * transaction commits (the lease election changes whether purchases owe use tax).
 */
export async function saveTaxPolicyChoiceInTx(
  tx: Prisma.TransactionClient, actorId: string, field: TaxPolicyField, value: string,
): Promise<void> {
  const problem = taxPolicyValueProblem(field, value);
  if (problem) throw new Error(problem);
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
  const before = await tx.businessSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { shortTermLeaseElection: true, rdfHandling: true, retailDeliveryFeeDecision: true },
  });
  const data: Prisma.BusinessSettingsUpdateInput =
    field === "shortTermLeaseElection"
      ? { shortTermLeaseElection: value as ShortTermLeaseElection }
      : field === "rdfHandling"
        ? { rdfHandling: value as RdfHandling }
        : { retailDeliveryFeeDecision: value };
  await tx.businessSettings.update({ where: { id: "singleton" }, data });
  await tx.auditLog.create({
    data: { userId: actorId, action: "tax.setup.settings_updated",
      entityType: "BusinessSettings", entityId: "singleton",
      oldValue: { [field]: before[field] }, newValue: { [field]: value, via: "decisions" } },
  });
}

/** After a lease-election change commits: re-check purchases waiting on use tax, exactly like the Tax setup save. */
export async function afterTaxPolicyChange(field: TaxPolicyField): Promise<void> {
  if (field !== "shortTermLeaseElection") return;
  const { recalculatePendingPurchaseTax } = await import("./purchase-tax-catch-up");
  await recalculatePendingPurchaseTax(new Date(), 200);
}

/**
 * IN-35: the reporting basis (accrual or cash) on every filing account. Same lock order and audit action as the filing
 * account save. Refuses when no filing account exists yet, so a decision never records a change that did nothing.
 */
export async function saveFilingBasisForAllAccountsInTx(
  tx: Prisma.TransactionClient, actorId: string, basis: string,
): Promise<number> {
  const problem = reportingBasisProblem(basis);
  if (problem || basis === "UNDECIDED") throw new Error(problem ?? "Choose accrual or cash.");
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
  const accounts = await tx.$queryRaw<Array<{ id: string; basis: string }>>`
    SELECT "id", "basis"::text AS "basis" FROM "TaxFilingAccount" ORDER BY "id" FOR UPDATE`;
  if (accounts.length === 0) throw new Error("Add a tax filing account first (Taxes › Setup), then choose its basis.");
  for (const account of accounts) {
    if (account.basis === basis) continue;
    await tx.taxFilingAccount.update({
      where: { id: account.id },
      data: { basis: basis as TaxReportingBasis },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.setup.filing_account_saved",
        entityType: "TaxFilingAccount", entityId: account.id,
        oldValue: { basis: account.basis }, newValue: { basis, via: "decisions" } },
    });
  }
  return accounts.length;
}
