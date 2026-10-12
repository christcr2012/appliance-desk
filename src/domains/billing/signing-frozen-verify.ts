import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { FrozenSigningEvidence } from "./signing-frozen-evidence";

export type StoredSigningEvidence = {
  agreementId: string;
  serviceAddressId: string;
  sourceFingerprint: string;
  version: number;
  setupFeeCents: number;
  downPaymentCents: number;
  frozenAt: Date | null;
  frozenOrderFingerprint: string | null;
  frozenAllInCents: number | null;
  frozenSetupTaxCents: number | null;
  frozenChargeEvidence: unknown;
};
const cents = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const sha = (n: unknown): n is string => typeof n === "string" && /^[a-f0-9]{64}$/.test(n);
const object = (n: unknown): n is Record<string, unknown> => !!n && typeof n === "object" && !Array.isArray(n);

function verifyLine(row: StoredSigningEvidence): FrozenSigningEvidence {
  const value = row.frozenChargeEvidence;
  if (!row.frozenAt || !sha(row.frozenOrderFingerprint) ||
      !sha(row.sourceFingerprint) || !cents(row.frozenAllInCents) ||
      !cents(row.frozenSetupTaxCents) || !object(value))
    throw new Error("Frozen signing evidence is missing.");
  const { agreementId, serviceAddressId, sourceFingerprint, orderFingerprint,
    agreementVersion, setupFeeCents, downPaymentCents, setupTaxCents, allInCents,
    schemaVersion, jurisdictions } = value;
  if (schemaVersion !== 1 || agreementId !== row.agreementId ||
      serviceAddressId !== row.serviceAddressId ||
      agreementVersion !== row.version || sourceFingerprint !== row.sourceFingerprint ||
      orderFingerprint !== row.frozenOrderFingerprint ||
      setupFeeCents !== row.setupFeeCents || downPaymentCents !== row.downPaymentCents ||
      setupTaxCents !== row.frozenSetupTaxCents ||
      allInCents !== row.frozenAllInCents ||
      !cents(setupFeeCents) || !cents(downPaymentCents) ||
      !cents(setupTaxCents) || !cents(allInCents) ||
      setupFeeCents + downPaymentCents + setupTaxCents !== allInCents ||
      !Array.isArray(jurisdictions)) throw new Error("Frozen signing evidence does not match the agreement.");
  let tax = 0;
  for (const item of jurisdictions) {
    if (!object(item) || typeof item.jurisdictionId !== "string" ||
        !item.jurisdictionId || typeof item.rateVersionId !== "string" ||
        !item.rateVersionId || !cents(item.taxableCents) ||
        !cents(item.exemptCents) || !cents(item.taxCents)) {
      throw new Error("Frozen jurisdiction evidence is missing.");
    }
    tax += item.taxCents;
    if (!cents(tax)) throw new Error("Frozen jurisdiction tax overflow.");
  }
  if (tax !== setupTaxCents) throw new Error("Frozen tax lines do not reconcile.");
  return value as unknown as FrozenSigningEvidence;
}

/** Recalculate the W-22C4 order digest from its independent persisted facts. */
export function verifyFrozenSigningOrder(
  rows: StoredSigningEvidence[],
  expectedAgreementIds: string[],
): FrozenSigningEvidence[] {
  if (!rows.length || rows.length > 500 || rows.length !== expectedAgreementIds.length ||
      new Set(expectedAgreementIds).size !== expectedAgreementIds.length)
    throw new Error("The complete frozen signing order is required.");
  const sorted = [...rows].sort((a, b) => a.agreementId.localeCompare(b.agreementId));
  const expected = [...expectedAgreementIds].sort((a, b) => a.localeCompare(b));
  if (sorted.some((row, i) => row.agreementId !== expected[i]))
    throw new Error("An agreement is missing from frozen evidence.");
  const evidence = sorted.map(verifyLine);
  const sourceFingerprint = evidence[0].sourceFingerprint;
  const orderFingerprint = evidence[0].orderFingerprint;
  if (evidence.some(line => line.sourceFingerprint !== sourceFingerprint ||
        line.orderFingerprint !== orderFingerprint))
    throw new Error("Frozen order versions do not match.");
  const lines = evidence.map(line => ({
    agreementId: line.agreementId,
    serviceAddressId: line.serviceAddressId,
    version: line.agreementVersion,
    setupFeeCents: line.setupFeeCents,
    downPaymentCents: line.downPaymentCents,
    setupTaxCents: line.setupTaxCents,
    allInCandidateCents: line.allInCents,
    jurisdictionEvidence: line.jurisdictions.map(row => ({
      jurisdictionId: row.jurisdictionId, rateVersionId: row.rateVersionId,
      taxableCents: row.taxableCents, exemptCents: row.exemptCents, taxCents: row.taxCents,
    })),
  }));
  const computed = createHash("sha256").update(JSON.stringify({ sourceFingerprint, lines })).digest("hex");
  if (computed !== orderFingerprint)
    throw new Error("Frozen all-in order fingerprint does not match.");
  return evidence;
}


/** Server-side read from a complete customer/order scope, not a browser-supplied amount. */
export async function getFrozenSigningOrderInTx(
  tx: Prisma.TransactionClient, agreementId: string,
): Promise<FrozenSigningEvidence[]> {
  const target = await tx.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { id: true, customerId: true, sourceEstimateId: true },
  });
  if (!target) throw new Error("Rental agreement is unavailable.");
  const scope = { customerId: target.customerId,
    ...(target.sourceEstimateId ? { sourceEstimateId: target.sourceEstimateId } : { id: target.id }) };
  const agreements = await tx.rentalAgreement.findMany({
    where: scope, select: { id: true, serviceAddressId: true }, orderBy: { id: "asc" },
  });
  if (!agreements.length || agreements.length > 500 ||
      !agreements.some(row => row.id === agreementId))
    throw new Error("The order scope has changed.");
  const charges = await tx.agreementSigningCharge.findMany({
    where: { agreementId: { in: agreements.map(row => row.id) } },
  });
  if (charges.length !== agreements.length || charges.some(charge =>
      agreements.find(agreement => agreement.id === charge.agreementId)?.serviceAddressId !== charge.serviceAddressId))
    throw new Error("Complete matching frozen signing evidence is required.");
  return verifyFrozenSigningOrder(charges, agreements.map(row => row.id));
}
