import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getAgreementTaxContext } from "@/domains/tax/locations";
import { assessPreparedSigningCharges } from "./signing-charge-readiness";
import { getEffectiveSetupTaxTreatmentInTx } from "./setup-tax-policy-version";
import { reviewSigningFeeTax, type SigningFeeTaxReview } from "./signing-charge-tax-evidence";
import { assembleSigningOrderDraft, type SigningOrderDraftContract } from "./signing-order-draft-contract";

export type PrivateOrderTaxPreview = {
  orderReady: boolean;
  orderDraft: SigningOrderDraftContract | null;
  reasons: string[];
  rows: Array<{
    agreementId: string;
    serviceAddressId: string;
    version: number;
    review: SigningFeeTaxReview;
  }>;
};

/**
 * Read-only W-22C3 order review. Uses stored agreements, not values submitted
 * by a customer or rendered in the browser. Never sends, freezes or collects.
 * Callers must check role before entering this helper. The transaction gives
 * one consistent source revision while related drafts/tax rules are loaded.
 */
export async function getDraftSigningTaxReviewInTx(
  tx: Prisma.TransactionClient,
  agreementId: string,
  effectiveOn: Date,
): Promise<PrivateOrderTaxPreview> {
  const blocked = (reasons: string[]): PrivateOrderTaxPreview => ({
    orderReady: false, orderDraft: null, reasons: [...new Set(reasons)], rows: [],
  });
  const target = await tx.rentalAgreement.findUnique({ where: { id: agreementId },
    select: { id: true, customerId: true, sourceEstimateId: true, status: true } });
  if (!target || target.status !== "DRAFT") return blocked(["No eligible draft agreement was found."]);

  const scope = { customerId: target.customerId,
    ...(target.sourceEstimateId ? { sourceEstimateId: target.sourceEstimateId } : { id: target.id }) };
  const agreements = await tx.rentalAgreement.findMany({ where: scope,
    select: { id: true, status: true, serviceAddressId: true },
    orderBy: { id: "asc" } });
  if (agreements.length === 0 || agreements.length > 500 ||
      agreements.some((row) => row.status !== "DRAFT")) {
    return blocked(["All agreements in this order must remain eligible drafts."]);
  }
  const charges = await tx.agreementSigningCharge.findMany({
    where: { agreementId: { in: agreements.map((row) => row.id) } },
    orderBy: { agreementId: "asc" },
  });
  if (charges.length !== agreements.length || charges.some((row) =>
      agreements.find((agreement) => agreement.id === row.agreementId)?.serviceAddressId !== row.serviceAddressId)) {
    return blocked(["Refresh signing charges for all delivery locations before reviewing tax."]);
  }
  // An old prepared snapshot, or a manually selected tax choice with no
  // actual CPA evidence, must never make the affected real-business path ready.
  const approvedTreatment = await getEffectiveSetupTaxTreatmentInTx(tx, effectiveOn);
  const reviewMissing = charges.some(row => row.setupFeeCents > 0 &&
    (approvedTreatment === "UNDECIDED" || row.setupFeeTaxTreatment !== approvedTreatment));
  const readiness = assessPreparedSigningCharges(agreements.map((row) => row.id), charges);
  if (!readiness.amountsReconciled) return blocked(readiness.reasons);

  const rows: PrivateOrderTaxPreview["rows"] = [];
  const problems: string[] = [];
  for (const charge of charges) {
    // A partially reviewed address may have some jurisdiction links while
    // other taxes are absent. Never show a complete-looking candidate.
    const taxLocation = await tx.addressTaxLocation.findFirst({
      where: { serviceAddressId: charge.serviceAddressId, isCurrent: true },
      select: { status: true },
    });
    if (charge.setupFeeCents > 0 && taxLocation?.status !== "VERIFIED") {
      const reason = "Verify every jurisdiction at this service address before reviewing setup tax.";
      const review: SigningFeeTaxReview = { status: "REVIEW_REQUIRED", reasons: [reason],
        setupTaxCents: null, candidateSigningTotalCents: null,
        jurisdictionLines: [], eligibleForCollection: false };
      rows.push({ agreementId: charge.agreementId, serviceAddressId: charge.serviceAddressId,
        version: charge.version, review });
      problems.push(`${charge.agreementId}: ${reason}`);
      continue;
    }
    const context = await getAgreementTaxContext(tx, charge.agreementId, effectiveOn);
    const ids = context.jurisdictions.map((row) => row.id);
    const rules = await tx.taxabilityRule.findMany({
      where: { category: "ADMINISTRATIVE_SETUP", OR: [
        { jurisdictionId: null }, { jurisdictionId: { in: ids } },
      ] },
      select: { category: true, jurisdictionId: true, taxability: true, cpaConfirmedOn: true },
    });
    const review = reviewSigningFeeTax({ setupFeeCents: charge.setupFeeCents,
      downPaymentCents: charge.downPaymentCents,
      setupFeeTaxTreatment: charge.setupFeeTaxTreatment,
      context, rules: rules.filter((rule) => rule.category === "ADMINISTRATIVE_SETUP").map((rule) => ({
        ...rule, category: "ADMINISTRATIVE_SETUP" as const,
      })) });
    if (review.status !== "CALCULATED_DRAFT") {
      problems.push(...review.reasons.map((reason) => `${charge.agreementId}: ${reason}`));
    }
    rows.push({ agreementId: charge.agreementId,
      serviceAddressId: charge.serviceAddressId, version: charge.version, review });
  }
  if (reviewMissing) problems.push(
    "Setup-fee tax approval is missing or changed. Record the CPA evidence in Settings and refresh the draft.");
  const orderDraft = problems.length === 0 ? assembleSigningOrderDraft({ agreements: charges, taxRows: rows }) : null;
  if (orderDraft?.status === "BLOCKED") problems.push(...orderDraft.reasons);
  return { orderReady: problems.length === 0 && orderDraft?.status === "OWNER_DRAFT_ONLY", orderDraft, reasons: [...new Set(problems)], rows };
}

/** Entry point exclusively for the authenticated owner/admin desk. */
export async function getDraftSigningTaxReview(agreementId: string): Promise<PrivateOrderTaxPreview> {
  await requireRole("OWNER", "ADMIN");
  return prisma.$transaction((tx) => getDraftSigningTaxReviewInTx(tx, agreementId, new Date()), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000,
  });
}
