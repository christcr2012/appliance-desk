import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/** Owner-only adjustment of an order/location. Invalidate every unpaid,
 * unfrozen sibling charge snapshot so no partial repricing can be sent. */
export async function saveSigningSetupFeeOverride(
  ownerUserId: string,
  agreementId: string,
  serviceAddressId: string,
  cents: number | null,
  explanation: string,
): Promise<void> {
  if (!agreementId || !serviceAddressId) throw new Error("Choose a valid draft and delivery location.");
  if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0 || cents > 1_000_000)) {
    throw new Error("Enter a setup fee from $0 to $10,000.");
  }
  const reason = explanation.trim();
  if (cents !== null && (reason.length < 5 || reason.length > 500))
    throw new Error("Record an owner reason of 5 to 500 characters for the adjusted setup fee.");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    const target = await tx.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { id: true, customerId: true, sourceEstimateId: true, status: true },
    });
    if (!target || target.status !== "DRAFT") throw new Error("Only draft orders can adjust a setup fee.");
    const agreements = await tx.rentalAgreement.findMany({
      where: { customerId: target.customerId,
        ...(target.sourceEstimateId ? { sourceEstimateId: target.sourceEstimateId } : { id: agreementId }) },
      select: { id: true, serviceAddressId: true, status: true }, orderBy: { id: "asc" },
    });
    const ids = agreements.map(row => row.id);
    if (!ids.length || ids.length > 500 || !ids.includes(agreementId) ||
      agreements.some(row => row.status !== "DRAFT")) throw new Error("Every order agreement must remain a draft.");
    await tx.$queryRaw`SELECT "id" FROM "RentalAgreement"
      WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    // The first actor check already holds a User FOR SHARE lock until commit;
    // repeat the explicit role read here for defense in depth at the write point.
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    // Recheck after row locking: a concurrent send/cancel must not allow
    // adjustments based on a previously observed DRAFT status.
    const locked = await tx.rentalAgreement.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, customerId: true, sourceEstimateId: true,
        serviceAddressId: true },
      orderBy: { id: "asc" },
    });
    if (locked.length !== agreements.length || locked.some((row, i) =>
      row.id !== agreements[i].id || row.status !== "DRAFT" ||
      row.customerId !== target.customerId ||
      row.sourceEstimateId !== target.sourceEstimateId ||
      row.serviceAddressId !== agreements[i].serviceAddressId)) {
      throw new Error("The draft order changed during review. Refresh before adjusting fees.");
    }
    const onAddress = locked.filter(row => row.serviceAddressId === serviceAddressId);
    if (!onAddress.length) throw new Error("This delivery location does not belong to the draft order.");
    const canonicalId = onAddress[0].id;
    const existing = await tx.signingSetupFeeOverride.findMany({
      where: { agreementId: { in: onAddress.map(row => row.id) } },
      orderBy: { agreementId: "asc" },
    });
    if (existing.length > 1 || (existing.length === 1 && existing[0].agreementId !== canonicalId))
      throw new Error("This location has conflicting override history. Reconcile before proceeding.");
    const frozen = await tx.agreementSigningCharge.count({
      where: { agreementId: { in: ids }, frozenAt: { not: null } },
    });
    if (frozen) throw new Error("The signed or frozen order cannot be repriced.");
    const old = existing[0];
    if (cents === null && !old) return;
    if (old && cents === old.setupFeeCents && reason === old.reason) return;
    if (cents === null) {
      await tx.signingSetupFeeOverride.delete({ where: { agreementId: canonicalId } });
    } else {
      await tx.signingSetupFeeOverride.upsert({
        where: { agreementId: canonicalId },
        create: { agreementId: canonicalId, setupFeeCents: cents,
          reason, authorizedByUserId: ownerUserId },
        update: { setupFeeCents: cents, reason, authorizedByUserId: ownerUserId },
      });
    }
    await tx.agreementSigningCharge.deleteMany({
      where: { agreementId: { in: ids }, frozenAt: null },
    });
    await tx.auditLog.create({ data: {
      userId: ownerUserId,
      action: "agreement.signing_setup_fee_override",
      entityType: "RentalAgreement", entityId: canonicalId,
      oldValue: old ? { setupFeeCents: old.setupFeeCents, reason: old.reason } : Prisma.JsonNull,
      newValue: cents === null ? { restoredDefault: true, serviceAddressId }
        : { setupFeeCents: cents, reason, serviceAddressId },
    } });
  }, { timeout: 20_000 });
}
