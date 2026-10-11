import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/** Owner/admin-only review of *prepared draft*, never a payable invoice. */
export async function getPreparedSigningChargeReview(agreementId: string) {
  await requireRole("OWNER", "ADMIN");
  const target = await prisma.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { id: true, customerId: true, sourceEstimateId: true, status: true },
  });
  if (!target || target.status !== "DRAFT") return [];
  const siblings = await prisma.rentalAgreement.findMany({
    where: {
      customerId: target.customerId,
      ...(target.sourceEstimateId
        ? { sourceEstimateId: target.sourceEstimateId } : { id: target.id }),
    },
    select: { id: true, status: true },
  });
  if (siblings.length === 0 || siblings.some((row) => row.status !== "DRAFT")) return [];
  const snapshots = await prisma.agreementSigningCharge.findMany({
    where: { agreementId: { in: siblings.map((row) => row.id) },
      agreement: { customerId: target.customerId, status: "DRAFT" } },
    select: {
      id: true, agreementId: true, serviceAddressId: true,
      machineCount: true, setupFeeCents: true, downPaymentCents: true,
      signingSubtotalCents: true, firstMonthRentCents: true,
      version: true, frozenAt: true, setupFeeTaxTreatment: true, sourceFingerprint: true,
      updatedAt: true,
      agreement: { select: {
        serviceAddress: { select: { line1: true, city: true, state: true, zip: true } },
      } },
    },
    orderBy: { agreementId: "asc" },
  });
  // Never present partial order figures as a complete preparation.
  return snapshots.length === siblings.length ? snapshots : [];
}
