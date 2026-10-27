import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import type { TaxYearFacts } from "@prisma/client";

/**
 * CMP-2 — the per-year tax facts (Business facts screen, OWNER only):
 * what last year's return actually said. The quarterly estimates are
 * computed from these (estimates.ts) and the 1099-K tie-out compares
 * against the typed 1099-K gross (k-reconciliation.ts). Every field is
 * optional and stays null until someone types it — a missing figure
 * produces words ("ask your CPA"), never an invented number.
 */

export interface TaxYearFactsInput {
  federalTaxCents?: number | null;
  federalAgiCents?: number | null;
  coloradoTaxCents?: number | null;
  form1099KGrossCents?: number | null;
  /** TAXBEN-1: self-employed health insurance premiums and the months an employer plan (own or spouse's) was available. */
  seHealthPremiumCents?: number | null;
  seHealthEmployerPlanMonths?: number[] | null;
}

export async function getTaxYearFacts(year: number): Promise<TaxYearFacts | null> {
  return prisma.taxYearFacts.findUnique({ where: { year } });
}

function checkCents(label: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole amount of money, or left blank.`);
  }
}

export async function saveTaxYearFacts(
  actorId: string,
  year: number,
  input: TaxYearFactsInput,
): Promise<void> {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100) throw new Error("That year could not be read.");
  checkCents("Last year's federal tax", input.federalTaxCents);
  checkCents("Last year's federal income (AGI)", input.federalAgiCents);
  checkCents("Last year's Colorado tax", input.coloradoTaxCents);
  checkCents("The 1099-K amount", input.form1099KGrossCents);
  checkCents("The health insurance premiums", input.seHealthPremiumCents);
  if (input.seHealthEmployerPlanMonths !== undefined && input.seHealthEmployerPlanMonths !== null) {
    const months = input.seHealthEmployerPlanMonths;
    if (
      !Array.isArray(months) ||
      months.some((m) => !Number.isInteger(m) || m < 1 || m > 12) ||
      new Set(months).size !== months.length
    ) {
      throw new Error("The employer-plan months look wrong — check them and try again.");
    }
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const existing = await tx.taxYearFacts.findUnique({ where: { year } });
    if (existing) {
      await tx.$queryRaw`SELECT "id" FROM "TaxYearFacts" WHERE "id" = ${existing.id} FOR UPDATE`;
    }
    const data: Record<string, number | number[] | null> = {};
    const changedFields: string[] = [];
    const fields: Array<[keyof TaxYearFactsInput, string]> = [
      ["federalTaxCents", "federalTaxCents"],
      ["federalAgiCents", "federalAgiCents"],
      ["coloradoTaxCents", "coloradoTaxCents"],
      ["form1099KGrossCents", "form1099KGrossCents"],
      ["seHealthPremiumCents", "seHealthPremiumCents"],
      ["seHealthEmployerPlanMonths", "seHealthEmployerPlanMonths"],
    ];
    for (const [key, column] of fields) {
      if (input[key] !== undefined) {
        data[column] = input[key] ?? null;
        changedFields.push(column);
      }
    }
    if (existing) await tx.taxYearFacts.update({ where: { year }, data });
    else await tx.taxYearFacts.create({ data: { year, ...data } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "compliance.tax_year_facts.save",
        entityType: "TaxYearFacts",
        entityId: String(year),
        newValue: { changedFields },
      },
    });
  });
}
