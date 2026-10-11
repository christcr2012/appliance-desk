import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { calculateDraftSigningPreview, type DraftSigningAgreement } from "./signing-charge-preview";


/**
 * W-22B: persist a prepared, *unpaid* draft plan attributed to each agreement.
 * The only legitimate caller supplies the authenticated owner/admin user ID.
 * No external payment provider is called inside (or after) this transaction.
 */
export async function prepareDraftSigningChargeSnapshots(userId: string, agreementId: string) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const target = await tx.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { id: true, customerId: true, sourceEstimateId: true, status: true },
    });
    if (!target || target.status !== "DRAFT") {
      throw new Error("Only a draft agreement can have its signing costs prepared.");
    }

    const scope = {
      customerId: target.customerId,
      ...(target.sourceEstimateId ? { sourceEstimateId: target.sourceEstimateId } : { id: target.id }),
    };
    const ids = (await tx.rentalAgreement.findMany({
      where: scope, select: { id: true }, orderBy: { id: "asc" },
    })).map((row) => row.id);
    if (!ids.includes(agreementId) || !ids.length || ids.length > 500) {
      throw new Error("The draft order is no longer available.");
    }
    // Deterministic shared lock order across competing preparation requests.
    await tx.$queryRaw`SELECT "id" FROM "RentalAgreement"
      WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings"
      WHERE "id" = 'singleton' FOR SHARE`;
    const agreements = await tx.rentalAgreement.findMany({
        where: { id: { in: ids } }, orderBy: { id: "asc" },
        select: {
          id: true, sourceEstimateId: true, customerId: true, serviceAddressId: true,
          status: true, paidInFullInAdvance: true,
          lines: {
            orderBy: { id: "asc" },
            select: { id: true, monthlyPriceCents: true,
              package: { select: { components: { select: { quantity: true } } } } },
          },
        },
      });
    const customer = await tx.customer.findUnique({ where: { id: target.customerId },
      select: { isBusiness: true, isPropertyManager: true } });
    const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" } });
    if (!customer || !settings || agreements.length !== ids.length ||
      agreements.some((agreement) => agreement.status !== "DRAFT" ||
        agreement.customerId !== target.customerId ||
        agreement.lines.length === 0)) {
      throw new Error("Every order agreement must remain a complete draft.");
    }

    const addressIds = [...new Set(agreements.map((row) => row.serviceAddressId))];
    const alreadyRented = await tx.rentalAgreement.findMany({
      where: { serviceAddressId: { in: addressIds }, status: "ACTIVE" },
      select: { serviceAddressId: true },
    });
    const planSettings = {
      setupFeeCents: settings.administrativeSetupFeeCents,
      largeOrderMachineThreshold: settings.largeOrderMachineThreshold,
      businessRequiresDownPayment: settings.businessRequiresDownPayment,
      setupFeeTaxTreatment: (settings.setupFeeTaxTreatment === "TAXABLE" ||
        settings.setupFeeTaxTreatment === "NOT_TAXABLE"
          ? settings.setupFeeTaxTreatment : "UNDECIDED") as "TAXABLE" | "NOT_TAXABLE" | "UNDECIDED",
    };
    const plan = calculateDraftSigningPreview({
      agreements: agreements as DraftSigningAgreement[],
      existingActiveAddressIds: alreadyRented.map((row) => row.serviceAddressId),
      businessCustomer: customer.isBusiness,
      propertyManagerCustomer: customer.isPropertyManager,
      settings: planSettings,
    });

    const fingerprint = createHash("sha256").update(JSON.stringify({
      agreements, alreadyRented: alreadyRented.map((row) => row.serviceAddressId).sort(),
      customer, settings: planSettings, settingsUpdatedAt: settings.updatedAt.toISOString(),
    })).digest("hex");
    const byAddress = new Map(plan.locations.map((location) => [location.serviceAddressId, location]));
    const feeAssigned = new Set<string>();
    const prepared = [];
    for (const agreement of agreements) {
      const amount = byAddress.get(agreement.serviceAddressId);
      if (!amount) throw new Error("Missing location allocation.");
      const setupFeeCents = feeAssigned.has(agreement.serviceAddressId) ? 0 : amount.setupFeeCents;
      feeAssigned.add(agreement.serviceAddressId);
      const firstMonthRentCents = agreement.paidInFullInAdvance ? 0 :
        agreement.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0);
      const downPaymentCents = plan.largeOrder ? firstMonthRentCents : 0;
      const machineCount = agreement.lines.reduce((sum, line) => sum +
        (line.package ? line.package.components.reduce((subtotal, item) => subtotal + item.quantity, 0) : 1), 0);
      if (!Number.isSafeInteger(firstMonthRentCents) || !Number.isSafeInteger(machineCount) ||
        !Number.isSafeInteger(setupFeeCents + downPaymentCents)) {
        throw new Error("The order contains invalid amounts.");
      }
      const previous = await tx.agreementSigningCharge.findUnique({ where: { agreementId: agreement.id } });
      if (previous?.frozenAt && previous.sourceFingerprint !== fingerprint) {
        throw new Error("Frozen signing charges cannot be repriced.");
      }
      if (previous?.sourceFingerprint === fingerprint) {
        prepared.push(previous);
        continue;
      }
      const input = {
        serviceAddressId: agreement.serviceAddressId,
        sourceEstimateId: target.sourceEstimateId,
        machineCount,
        firstMonthRentCents,
        setupFeeCents,
        downPaymentCents,
        signingSubtotalCents: setupFeeCents + downPaymentCents,
        setupFeeTaxTreatment: planSettings.setupFeeTaxTreatment,
        settingsUpdatedAt: settings.updatedAt,
        sourceFingerprint: fingerprint,
        createdByUserId: userId,
      };
      const result = previous
        ? await tx.agreementSigningCharge.update({
            where: { agreementId: agreement.id },
            data: { ...input, version: { increment: 1 } },
          })
        : await tx.agreementSigningCharge.create({ data: { agreementId: agreement.id, ...input } });
      await tx.auditLog.create({
        data: {
          userId, action: "agreement.signing_charges_prepared",
          entityType: "RentalAgreement", entityId: agreement.id,
          newValue: { version: result.version, sourceFingerprint: fingerprint,
            setupFeeCents, downPaymentCents, requiresTaxReview: plan.requiresTaxReview },
        },
      });
      prepared.push(result);
    }

    if (prepared.reduce((sum, row) => sum + row.setupFeeCents, 0) !== plan.setupTotalCents ||
      prepared.reduce((sum, row) => sum + row.downPaymentCents, 0) !== plan.downPaymentTotalCents) {
      throw new Error("Signing allocations did not reconcile with the order.");
    }
    return { snapshots: prepared, requiresTaxReview: plan.requiresTaxReview,
      amountBeforeTaxCents: plan.amountDueAtSigningCents };
  }, { timeout: 20_000 });
}
