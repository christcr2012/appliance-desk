import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Real-business policy resolution always uses a Colorado-local calendar day.
 * A historical effective-date string never becomes active the prior Denver
 * evening when UTC crosses midnight, including during either DST boundary. */
export type SetupTaxPolicyVersion = {
  treatment: string;
  effectiveFromKey: string;
  cpaConfirmedOnKey: string | null;
  decisionNote: string | null;
  adviserReference: string | null;
  ownerApprovedAt: Date;
  cancelledAt: Date | null;
};

export function resolveSetupTaxPolicy(
  versions: readonly SetupTaxPolicyVersion[],
  instant: Date,
): "UNDECIDED" | "TAXABLE" | "NOT_TAXABLE" {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return "UNDECIDED";
  const today = businessDateKey(instant);
  const eligible = versions.filter(v =>
    v.cancelledAt === null && v.effectiveFromKey <= today && v.ownerApprovedAt <= instant);
  const ordered = [...eligible].sort((a, b) =>
    b.effectiveFromKey.localeCompare(a.effectiveFromKey) ||
    b.ownerApprovedAt.getTime() - a.ownerApprovedAt.getTime());
  const current = ordered[0];
  if (!current || !["TAXABLE", "NOT_TAXABLE"].includes(current.treatment) ||
      !current.cpaConfirmedOnKey || current.cpaConfirmedOnKey > today ||
      !current.decisionNote || current.decisionNote.trim().length < 10 ||
      !current.adviserReference || current.adviserReference.trim().length < 10)
    return "UNDECIDED";
  return current.treatment as "TAXABLE" | "NOT_TAXABLE";
}

/** Call inside an existing finance transaction when one is present.
 * Returns no assumed approval if no owner-written version exists. */
export async function getEffectiveSetupTaxTreatmentInTx(
  tx: Prisma.TransactionClient,
  at: Date,
): Promise<"UNDECIDED" | "TAXABLE" | "NOT_TAXABLE"> {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) return "UNDECIDED";
  const rows = await tx.setupFeeTaxDecisionVersion.findMany({
    where: { effectiveFromKey: { lte: businessDateKey(at) },
      ownerApprovedAt: { lte: at }, cancelledAt: null },
    orderBy: [{ effectiveFromKey: "desc" }, { ownerApprovedAt: "desc" }, { id: "desc" }],
    take: 2,
    select: { treatment: true, effectiveFromKey: true, cpaConfirmedOnKey: true,
      decisionNote: true, adviserReference: true, ownerApprovedAt: true, cancelledAt: true },
  });
  return resolveSetupTaxPolicy(rows, at);
}
export async function getEffectiveSetupTaxTreatment(at = new Date()) {
  return prisma.$transaction(tx => getEffectiveSetupTaxTreatmentInTx(tx, at));
}
