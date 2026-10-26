import { attachEstimateDepositSourceAfterConversion } from "@/domains/billing/deposit-provenance";
import {
  convertEstimateToAgreements as convertEstimateToAgreementsBase,
  type ConvertEstimateInput,
} from "./index-base";

export type {
  NewEstimateInput,
  NewEstimateForLeadInput,
  NewEstimateLineItemInput,
  ApproveEstimateInput,
  ConvertEstimateInput,
} from "./index-base";
export {
  createEstimateDraft,
  createEstimateDraftForNewLead,
  addEstimateLineItem,
  removeEstimateLineItem,
  getEstimatesForCustomer,
  getAllEstimates,
  getEstimateDetail,
  totalMonthlyCents,
  totalOneTimeCents,
  sendEstimate,
  sendEstimateFollowUpReminders,
  getEstimateForApproval,
  approveEstimate,
  requestEstimateChanges,
  resolveConversionAddresses,
} from "./index-base";

export async function convertEstimateToAgreements(
  userId: string,
  estimateId: string,
  input: ConvertEstimateInput,
) {
  // ZONE-1: never convert while an address would be delivered without a known zone (the confirm-zone To do would be
  // dropped with nothing taking over). An approved estimate's zones can only be settled, not changed.
  const { prisma } = await import("@/lib/prisma");
  const { unresolvedDeliveryAddresses, UNRESOLVED_ZONE_MESSAGE } = await import("@/domains/delivery/snapshot");
  const zoneCheck = await prisma.estimate.findUnique({ where: { id: estimateId },
    select: { status: true, deliveryZoneSnapshot: true, lineItems: { select: { serviceAddressId: true } } } });
  if (zoneCheck && zoneCheck.status !== "CONVERTED" &&
      unresolvedDeliveryAddresses(zoneCheck.deliveryZoneSnapshot, zoneCheck.lineItems.map((line) => line.serviceAddressId)).length)
    throw new Error(UNRESOLVED_ZONE_MESSAGE);
  const agreementIds = await convertEstimateToAgreementsBase(
    userId,
    estimateId,
    input,
  );
  await attachEstimateDepositSourceAfterConversion(estimateId, agreementIds);
  // ZONE-1: each agreement keeps its address's frozen delivery zone and delivery/pickup choice.
  const { copyEstimateZoneToAgreements } = await import("@/domains/delivery/estimate-zone");
  await copyEstimateZoneToAgreements(estimateId, agreementIds);
  return agreementIds;
}
