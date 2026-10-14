import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getFrozenSigningOrderInTx } from "./signing-frozen-verify";
import type { FrozenSigningEvidence } from "./signing-frozen-evidence";

export type ReviewedSigningOrderReadback = {
  orderFingerprint: string;
  currentAgreementId: string;
  locations: Array<{
    agreementId: string;
    serviceAddress: string;
    setupFeeCents: number;
    setupTaxCents: number;
    downPaymentCents: number;
    signingAmountCents: number;
    current: boolean;
  }>;
  totals: { setupFeeCents: number; setupTaxCents: number;
    downPaymentCents: number; signingAmountCents: number };
};

function addCents(a: number, b: number): number {
  const value = a + b;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Frozen order amounts cannot be safely summed.");
  return value;
}

/** Only consume rows that already passed the full stored SHA-256 verification. */
export function presentReviewedSigningOrder(
  verified: readonly FrozenSigningEvidence[],
  addresses: ReadonlyArray<{ id: string; line1: string; line2?: string | null;
    city: string; state: string; zip: string }>,
  currentAgreementId: string,
): ReviewedSigningOrderReadback {
  if (!verified.length || verified.length > 500 ||
      new Set(verified.map(x => x.agreementId)).size !== verified.length ||
      !verified.some(x => x.agreementId === currentAgreementId) ||
      new Set(verified.map(x => x.serviceAddressId)).size !== verified.length ||
      new Set(verified.map(x => x.orderFingerprint)).size !== 1 ||
      !/^[a-f0-9]{64}$/.test(verified[0].orderFingerprint)) {
    throw new Error("Complete matching frozen order is required.");
  }
  const addressById = new Map(addresses.map(x => [x.id, x]));
  if (addressById.size !== verified.length ||
      verified.some(line => !addressById.has(line.serviceAddressId))) {
    throw new Error("A service address is missing from the reviewed order.");
  }
  const totals = { setupFeeCents: 0, setupTaxCents: 0,
    downPaymentCents: 0, signingAmountCents: 0 };
  const locations = [...verified].sort((a,b) => a.agreementId.localeCompare(b.agreementId)).map(line => {
    const addr = addressById.get(line.serviceAddressId)!;
    const values = [line.setupFeeCents,line.setupTaxCents,line.downPaymentCents,line.allInCents];
    if (values.some(value => !Number.isSafeInteger(value) || value < 0) ||
        addCents(addCents(line.setupFeeCents,line.setupTaxCents),line.downPaymentCents) !== line.allInCents) {
      throw new Error("Frozen signing values disagree.");
    }
    totals.setupFeeCents = addCents(totals.setupFeeCents,line.setupFeeCents);
    totals.setupTaxCents = addCents(totals.setupTaxCents,line.setupTaxCents);
    totals.downPaymentCents = addCents(totals.downPaymentCents,line.downPaymentCents);
    totals.signingAmountCents = addCents(totals.signingAmountCents,line.allInCents);
    return {
      agreementId: line.agreementId,
      serviceAddress: [addr.line1,addr.line2,addr.city,addr.state,addr.zip].filter(Boolean).join(", "),
      setupFeeCents: line.setupFeeCents, setupTaxCents: line.setupTaxCents,
      downPaymentCents: line.downPaymentCents, signingAmountCents: line.allInCents,
      current: line.agreementId === currentAgreementId,
    };
  });
  if (addCents(addCents(totals.setupFeeCents,totals.setupTaxCents),totals.downPaymentCents) !== totals.signingAmountCents)
    throw new Error("Frozen order totals disagree.");
  return { orderFingerprint: verified[0].orderFingerprint,currentAgreementId,locations,totals };
}

/** Never load/order/display another customer's service address through a public signing URL. */
export async function getReviewedSigningOrderReadbackInTx(
  tx: Prisma.TransactionClient,
  agreementId: string,
): Promise<ReviewedSigningOrderReadback> {
  const rows = await getFrozenSigningOrderInTx(tx, agreementId);
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId }, select: { customerId: true },
  });
  const addresses = await tx.serviceAddress.findMany({
    where: { customerId: agreement.customerId,
      id: { in: rows.map(row => row.serviceAddressId) } },
    select: { id: true,line1: true,line2: true,city: true,state: true,zip: true },
  });
  return presentReviewedSigningOrder(rows,addresses,agreementId);
}

export async function getReviewedSigningOrderReadback(agreementId: string) {
  return prisma.$transaction(tx => getReviewedSigningOrderReadbackInTx(tx,agreementId));
}
