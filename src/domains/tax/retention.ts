import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { ruleAsOf } from "@/domains/rules/reads";
import { saveRuleVersionInTx } from "@/domains/rules/changes";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

import { RECOMMENDED_RETENTION_YEARS, retentionYearsProblem } from "./retention-rules";

export { RECOMMENDED_RETENTION_YEARS, retentionYearsProblem };

/** Owner-only, audited, compare-and-set so two sessions cannot overwrite each other silently. */
export async function saveRecordRetentionYears(actorId: string, years: number, expectedYears: number): Promise<void> {
  const problem = retentionYearsProblem(years);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(expectedYears)) throw new Error("Reload the page and try again.");
  await prisma.$transaction((tx) => saveRecordRetentionYearsInTx(tx, actorId, years, expectedYears));
}

/** The same save inside a transaction the caller owns (Decisions & reviews). */
export async function saveRecordRetentionYearsInTx(
  tx: Prisma.TransactionClient, actorId: string, years: number, expectedYears: number,
  professionalAnswer = false,
): Promise<void> {
  const problem = retentionYearsProblem(years);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(expectedYears)) throw new Error("Reload the page and try again.");
  // ACCT-1: accountant only as a CPA professional answer through Decisions & reviews.
  await assertActiveTeamActor(tx, actorId, professionalAnswer ? ["ACCOUNTANT"] : ["OWNER"]);
  // TFA-1: the keep-years value is a dated rule version, not a setting. The
  // compare-and-set still guards against two sessions overwriting each other.
  // (The pending IN-71 change is cancelled by the rule-version save itself.)
  const current = (await ruleAsOf<number>("records.keep_years", new Date(), tx)).value;
  if (current !== expectedYears) throw new Error("This setting was changed in another session. Reload before saving.");
  if (years !== expectedYears) {
    const today = businessDateFromKey(businessDateKey(new Date()))!;
    await saveRuleVersionInTx(tx, actorId, {
      key: "records.keep_years",
      value: years,
      effectiveFrom: today,
      reason: "Changed on the record-keeping screen.",
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.record_retention.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { recordRetentionYears: expectedYears }, newValue: { recordRetentionYears: years } },
    });
  }
}

export async function getRecordRetentionYears(): Promise<number> {
  return (await ruleAsOf<number>("records.keep_years", new Date())).value;
}
