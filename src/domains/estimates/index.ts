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
