import { businessDateFromKey } from "@/lib/business-date";

export type SetupTaxApprovalForm = {
  treatment: string;
  note: string;
  confirmedOn: string;
  effectiveFrom: string;
  reference: string;
  attested: boolean;
};
// Date-only owner fields are Colorado calendar dates, never midnight UTC.
function date(value: string): Date | null {
  return businessDateFromKey(value);
}
/** Owner acknowledgement is required each time a decided policy is saved.
 * No assumed or invented professional review; any undecided save clears prior approval. */
export function parseSetupTaxOwnerApproval(input: SetupTaxApprovalForm, now = new Date()) {
  if (input.treatment === "UNDECIDED") return {
    setupFeeTaxDecisionNote: null,
    setupFeeTaxConfirmedOn: null,
    setupFeeTaxEffectiveFrom: null,
    setupFeeTaxApprovedAt: null,
    setupFeeTaxAdviserReference: null,
  };
  if (!["TAXABLE", "NOT_TAXABLE"].includes(input.treatment)) throw new Error("Choose a valid tax decision.");
  if (!input.attested) throw new Error("Confirm the CPA actually reviewed this setup-fee decision.");
  const confirmed = date(input.confirmedOn);
  const effective = date(input.effectiveFrom);
  if (!confirmed || !effective || confirmed > now)
    throw new Error("Enter a valid CPA date no later than today and a valid effective date.");
  if (input.note.trim().length < 10 || input.note.trim().length > 500)
    throw new Error("Record the CPA's reasoning (10–500 characters).");
  if (input.reference.trim().length < 10 || input.reference.trim().length > 500)
    throw new Error("Provide a traceable CPA name and guidance reference (10–500 characters).");
  return {
    setupFeeTaxDecisionNote: input.note.trim(),
    setupFeeTaxConfirmedOn: confirmed,
    setupFeeTaxEffectiveFrom: effective,
    setupFeeTaxApprovedAt: now,
    setupFeeTaxAdviserReference: input.reference.trim(),
  };
}
