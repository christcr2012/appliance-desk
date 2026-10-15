import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getReviewedSigningOrderReadbackInTx } from "@/domains/billing/signing-order-readback";
import { getAgreementTaxContext } from "@/domains/tax/locations";
import { computeTax } from "@/domains/tax/engine";
import { effectiveMandatorySigningPolicy } from "@/domains/billing/signing-mandatory-policy";
import { verifyPreparedEstimateScope } from "./preapproval-agreements";

type EstimateQuoteInput = {
  estimateId: string;
  customerId: string | null;
  depositCents: number;
  lineItems: Array<{
    id: string; serviceAddressId: string | null;
    packageId: string | null; monthlyPriceCents: number;
    oneTimeFeeCents: number; quantity: number;
  }>;
};
export type EstimatePreparedQuoteLocation = {
  agreementId: string;
  serviceAddressId: string;
  serviceAddress: string;
  monthlyRentCents: number;
  monthlyRentTaxCents: number;
  setupFeeCents: number;
  setupTaxCents: number;
  advanceCents: number;
  signingAmountCents: number;
  additionalItems?: Array<{ label: string; amountCents: number; status: string }>;
  rateVersionIds: string[];
};
export type EstimatePreparedQuote = {
  status: "READY" | "REVIEW_REQUIRED";
  reasons: string[];
  orderFingerprint: string | null;
  quoteFingerprint: string | null;
  locations: EstimatePreparedQuoteLocation[];
  totals: {
    monthlyRentCents: number;
    monthlyRentTaxCents: number;
    setupFeeCents: number;
    setupTaxCents: number;
    advanceCents: number;
    dueAtSigningCents: number;
  } | null;
  /** A verified technical candidate is not itself a license to transact. */
  permissionToCollect: false;
};

const cents = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000;
function rejected(reasons: string[]): EstimatePreparedQuote {
  return { status: "REVIEW_REQUIRED", reasons: [...new Set(reasons)],
    quoteFingerprint: null, orderFingerprint: null, locations: [], totals: null,
    permissionToCollect: false };
}
function total(values: readonly number[]): number {
  if (!values.every(cents)) throw new Error("Quote contains unsupported currency values.");
  const sum = values.reduce((a, b) => a + b, 0);
  if (!cents(sum)) throw new Error("Quote exceeds supported integer-cent bounds.");
  return sum;
}
export function assessEstimateQuoteCategories(input: {
  depositCents: number;
  hasUnclassifiedOneTimeFees: boolean;
  setupFeeCents: number;
  mandatory: ReturnType<typeof effectiveMandatorySigningPolicy>;
  damageWaiverEnabled: boolean;
  depositEnabled: boolean;
  configuredFees: readonly number[];
}): string[] {
  const issues: string[] = [];
  if (!cents(input.depositCents) || input.depositCents > 0)
    issues.push("Refundable deposit allocation/terms are not yet included in immutable signing charges.");
  if (input.depositEnabled && input.depositCents === 0)
    issues.push("Deposit is enabled but a reviewed deposit amount is missing.");
  if (input.hasUnclassifiedOneTimeFees)
    issues.push("Quote contains uncategorized one-time amounts; classify and tax them before making a binding offer.");
  if (!input.configuredFees.every(cents))
    issues.push("Configured delivery/installation/removal fee is invalid.");
  const policy = input.mandatory.decision;
  if (input.mandatory.revision === null)
    issues.push("No effective dated owner policy covers mandatory charge categories.");
  for (const key of ["delivery", "installation", "removal"] as const) {
    if (policy[key] !== "NOT_APPLICABLE")
      issues.push(key + " service charge must be specifically reviewed and allocated before a binding quote.");
  }
  if (policy.damageWaiver !== "NOT_APPLICABLE" || input.damageWaiverEnabled)
    issues.push("Damage waiver cost and customer consent require explicit agreement allocation.");
  if (policy.retailDelivery !== "EXEMPT")
    issues.push("Retail delivery fee applicability/rate must be independently verified.");
  if (input.configuredFees.some(value => value > 0))
    issues.push("Configured visit fees must be allocated into the frozen signing amount, not silently omitted.");
  if (input.setupFeeCents < 0)
    issues.push("Setup charges must not be negative.");
  return issues;
}
export function verifyQuotedPackageLines(input: {
  estimated: EstimateQuoteInput["lineItems"];
  actual: readonly { serviceAddressId: string; packageId: string | null; monthlyPriceCents: number }[];
}): string[] {
  const expected = new Map<string, number>();
  const actual = new Map<string, number>();
  const reasons: string[] = [];
  for (const item of input.estimated) {
    if (!item.serviceAddressId || !item.packageId || !cents(item.monthlyPriceCents) ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
      reasons.push("Each estimate rental line requires a real package, owned address and valid quantity.");
      continue;
    }
    const key = JSON.stringify([item.serviceAddressId, item.packageId, item.monthlyPriceCents]);
    expected.set(key, (expected.get(key) ?? 0) + item.quantity);
  }
  for (const item of input.actual) {
    if (!item.packageId || !cents(item.monthlyPriceCents))
      reasons.push("Agreement contains an unclassified package or rental price.");
    const key = JSON.stringify([item.serviceAddressId, item.packageId, item.monthlyPriceCents]);
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  if (expected.size !== actual.size ||
      [...expected].some(([key, count]) => actual.get(key) !== count))
    reasons.push("Real prepared agreement packages/prices differ from the original quote; review and refresh.");
  return [...new Set(reasons)];
}

/**
 * The read is scoped to the exact estimate/customer and ALL its prepared
 * agreements. The existing signing freeze verifies digests and immutable
 * per-address signing money; we additionally reconcile the actual appliance
 * packages, current monthly-tax jurisdiction evidence, and mandatory rules.
 * An unsent owner preview is never an authorization to charge.
 */
export async function getPreparedEstimateQuoteInTx(
  tx: Prisma.TransactionClient, estimateId: string,
  effectiveOn = new Date(),
): Promise<EstimatePreparedQuote> {
  const estimate = await tx.estimate.findUnique({
    where: { id: estimateId },
    select: { id: true, status: true, customerId: true, depositCents: true,
      lineItems: { select: {
        id: true, packageId: true, serviceAddressId: true,
        quantity: true, monthlyPriceCents: true, oneTimeFeeCents: true,
      } } },
  });
  if (!estimate || !estimate.customerId ||
      !["DRAFT", "CHANGES_REQUESTED", "SENT", "VIEWED", "APPROVED"].includes(estimate.status))
    return rejected(["An eligible customer-owned estimate is required for preapproval review."]);
  const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) return rejected(["Complete business settings and policy setup before preparing the quote."]);
  const policy = effectiveMandatorySigningPolicy(settings.signingMandatoryPolicyVersions, effectiveOn);
  const addresses = [...new Set(estimate.lineItems.map(line => line.serviceAddressId))];
  if (!estimate.lineItems.length || addresses.some(id => !id) || addresses.length > 500)
    return rejected(["Every original rental line must belong to a reviewed service address."]);
  const agreements = await tx.rentalAgreement.findMany({
    where: { sourceEstimateId: estimateId }, orderBy: { id: "asc" },
    select: { id: true, customerId: true, sourceEstimateId: true, serviceAddressId: true, status: true,
      lines: { select: { packageId: true, monthlyPriceCents: true } } },
  });
  let agreementIds: string[];
  try {
    agreementIds = verifyPreparedEstimateScope(agreements,
      addresses as string[], estimate.id, estimate.customerId);
  } catch (error) {
    return rejected([error instanceof Error ? error.message : "Unreviewed preparation scope."]);
  }
  const allActualLines = agreements.flatMap(a => a.lines.map(line => ({
    ...line, serviceAddressId: a.serviceAddressId,
  })));
  const issues = verifyQuotedPackageLines({
    estimated: estimate.lineItems, actual: allActualLines,
  });
  if (issues.length) return rejected(issues);
  try {
    const frozen = await getReviewedSigningOrderReadbackInTx(tx, agreementIds[0]);
    if (frozen.locations.length !== agreementIds.length ||
        frozen.locations.some(line => !agreementIds.includes(line.agreementId))) {
      return rejected(["Every service address needs the same complete frozen signing order."]);
    }
    const coverage = frozen.evidenceVersion === 2 ? [] : assessEstimateQuoteCategories({
      depositCents: estimate.depositCents,
      hasUnclassifiedOneTimeFees: estimate.lineItems.some(item => item.oneTimeFeeCents > 0),
      setupFeeCents: frozen.totals.setupFeeCents,
      mandatory: policy,
      damageWaiverEnabled: settings.damageWaiverEnabled,
      depositEnabled: settings.depositEnabled,
      configuredFees: [settings.oneTimeDeliveryFeeCents,
        settings.oneTimeInstallationFeeCents, settings.oneTimeRemovalFeeCents],
    });
    if (coverage.length) return rejected(coverage);

    const rows: EstimatePreparedQuoteLocation[] = [];
    for (const agreement of agreements) {
      const frozenAddress = frozen.locations.find(line => line.agreementId === agreement.id);
      if (!frozenAddress) return rejected(["Frozen order misses a prepared service address."]);
      const verifiedLocation = await tx.addressTaxLocation.findFirst({
        where: { serviceAddressId: agreement.serviceAddressId, isCurrent: true },
        select: { status: true },
      });
      if (verifiedLocation?.status !== "VERIFIED")
        return rejected(["Verify all service address tax jurisdictions before quoting rental tax."]);
      const monthlyRentCents = total(agreement.lines.map(line => line.monthlyPriceCents));
      const context = await getAgreementTaxContext(tx, agreement.id, effectiveOn);
      if (!context.jurisdictions.length ||
          context.jurisdictions.some(j => !j.rate))
        return rejected(["A complete effective-dated rate for each tax jurisdiction is required."]);
      const tax = computeTax({
        ...context, lines: [{ key: agreement.id, kind: "RENTAL", amountCents: monthlyRentCents }],
      });
      if (!tax.ok) return rejected(tax.problems);
      const taxVersionIds = tax.lines.map(line => line.rateVersionId).sort();
      rows.push({
        agreementId: agreement.id, serviceAddressId: agreement.serviceAddressId,
        serviceAddress: frozenAddress.serviceAddress,
        monthlyRentCents, monthlyRentTaxCents: tax.totalTaxCents,
        setupFeeCents: frozenAddress.setupFeeCents,
        setupTaxCents: frozenAddress.setupTaxCents,
        advanceCents: frozenAddress.downPaymentCents,
        signingAmountCents: frozenAddress.signingAmountCents,
        additionalItems: frozenAddress.additionalItems,
        rateVersionIds: taxVersionIds,
      });
    }
    rows.sort((a, b) => a.serviceAddressId.localeCompare(b.serviceAddressId));
    const totals = {
      monthlyRentCents: total(rows.map(row => row.monthlyRentCents)),
      monthlyRentTaxCents: total(rows.map(row => row.monthlyRentTaxCents)),
      setupFeeCents: total(rows.map(row => row.setupFeeCents)),
      setupTaxCents: total(rows.map(row => row.setupTaxCents)),
      advanceCents: total(rows.map(row => row.advanceCents)),
      dueAtSigningCents: total(rows.map(row => row.signingAmountCents)),
    };
    if (totals.setupFeeCents !== frozen.totals.setupFeeCents ||
        totals.setupTaxCents !== frozen.totals.setupTaxCents ||
        totals.advanceCents !== frozen.totals.downPaymentCents ||
        totals.dueAtSigningCents !== frozen.totals.signingAmountCents)
      return rejected(["Calculated and frozen order amounts do not reconcile."]);
    const quoteFingerprint = createHash("sha256").update(JSON.stringify({
      estimateId: estimate.id, customerId: estimate.customerId,
      orderFingerprint: frozen.orderFingerprint, policyRevision: policy.revision,
      originalEstimateLines: [...estimate.lineItems].sort((a, b) => a.id.localeCompare(b.id)),
      depositCents: estimate.depositCents, rows, totals,
    })).digest("hex");
    return {
      status: "READY", reasons: [], quoteFingerprint,
      orderFingerprint: frozen.orderFingerprint, locations: rows, totals,
      permissionToCollect: false,
    };
  } catch (error) {
    return rejected([error instanceof Error ? error.message :
      "An unexpected quote verification failure requires owner review."]);
  }
}
export async function getPreparedEstimateQuote(estimateId: string) {
  return prisma.$transaction(tx => getPreparedEstimateQuoteInTx(tx, estimateId));
}
