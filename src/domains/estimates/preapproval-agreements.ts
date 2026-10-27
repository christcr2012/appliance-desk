import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getBusinessSettings } from "@/domains/settings";
import { createDraftAgreementInTx } from "@/domains/agreements";
import type { ConvertEstimateInput } from "./index-base";

function ownedAddresses(lines: readonly { serviceAddressId: string | null; description: string }[],
  input: ConvertEstimateInput): string[] {
  if (input.mode === "single") {
    if (!input.serviceAddressId || lines.some(line =>
      line.serviceAddressId && line.serviceAddressId !== input.serviceAddressId))
      throw new Error("The selected single property must match every quoted address.");
    return [input.serviceAddressId];
  }
  if (lines.some(line => !line.serviceAddressId))
    throw new Error("Assign every line to an owned property before preparing agreements.");
  return [...new Set(lines.map(line => line.serviceAddressId!))];
}

export type PreparedEstimateAddress = {
  id: string;
  customerId: string;
  sourceEstimateId: string | null;
  serviceAddressId: string;
  status: string;
};

/** A preapproval draft belongs to exactly this quote/customer/location set. */
export function verifyPreparedEstimateScope(
  source: readonly PreparedEstimateAddress[],
  addresses: readonly string[],
  estimateId: string,
  customerId: string,
): string[] {
  const expected = new Set(addresses);
  if (!customerId || !estimateId || !expected.size || expected.size !== addresses.length
      || expected.size > 500 || source.length !== expected.size ||
      new Set(source.map(row => row.id)).size !== source.length ||
      new Set(source.map(row => row.serviceAddressId)).size !== source.length ||
      source.some(row => row.customerId !== customerId ||
        row.sourceEstimateId !== estimateId || row.status !== "DRAFT" ||
        !expected.has(row.serviceAddressId))) {
    throw new Error("Prepared agreements no longer match every original customer-owned delivery location.");
  }
  return source.map(row => row.id).sort();
}

/**
 * Owner preparation does NOT approve or convert the estimate. It creates
 * customer-owned draft shells so the existing signing planner/CPA tax engine
 * can prepare actual inventory lines and immutable signing evidence BEFORE
 * the customer sees a binding offer. No deposits, email or signature.
 */
export async function prepareEstimateAgreementsBeforeApproval(
  actorId: string,
  estimateId: string,
  input: ConvertEstimateInput,
) {
  const settings = await getBusinessSettings();
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Estimate" WHERE "id" = ${estimateId} FOR UPDATE`;
    const estimate = await tx.estimate.findUniqueOrThrow({
      where: { id: estimateId },
      select: { status: true, customerId: true, depositCents: true,
        lineItems: { select: {
          serviceAddressId: true, description: true, quantity: true,
          packageId: true, monthlyPriceCents: true,
        } },
      },
    });
    if (!["DRAFT", "CHANGES_REQUESTED"].includes(estimate.status) ||
        !estimate.customerId)
      throw new Error("Prepare only an editable estimate for an existing customer. Convert new leads after account review.");
    if (!estimate.lineItems.length || estimate.lineItems.some(row =>
      !row.packageId || !Number.isSafeInteger(row.quantity) || row.quantity < 1 ||
      !Number.isSafeInteger(row.monthlyPriceCents) || row.monthlyPriceCents < 0))
      throw new Error("Assign real priced appliance packages to every estimate line before preparation.");
    const addresses = ownedAddresses(estimate.lineItems, input).sort();
    if (!addresses.length || addresses.length > 500)
      throw new Error("Prepare between 1 and 500 verified delivery locations.");
    // A single-location quote may not borrow lines from unrelated addresses.
    if (input.mode === "single" && estimate.lineItems.some(row =>
      row.serviceAddressId && row.serviceAddressId !== input.serviceAddressId))
      throw new Error("The selected single address conflicts with another quoted location.");
    const existing = await tx.rentalAgreement.findMany({
      where: { sourceEstimateId: estimateId },
      select: { id: true, customerId: true, sourceEstimateId: true,
        serviceAddressId: true, status: true },
    });
    if (existing.length) return verifyPreparedEstimateScope(existing, addresses, estimateId, estimate.customerId);

    // Existing agreement creation validates customer ownership of every
    // address under this same transaction. All shells or none are created.
    const created: string[] = [];
    for (const address of addresses) {
      const agreement = await createDraftAgreementInTx(tx, actorId,
        { customerId: estimate.customerId, serviceAddressId: address,
          // The estimate amount is an aggregate, never one whole reserve per
          // property. OWNER must explicitly allocate it across these drafts.
          depositCents: 0 },
        { sourceEstimateId: estimateId, settings, skipDeliveryReadinessCheck: true });
      created.push(agreement.id);
    }
    await tx.auditLog.create({
      data: { userId: actorId, action: "estimate.prepare_signing_drafts",
        entityType: "Estimate", entityId: estimateId,
        newValue: { preparedAgreementIds: created, addresses,
          note: "Owner preparation only; not sent, approved, converted or charged" },
      },
    });
    return created.sort();
  });
}
