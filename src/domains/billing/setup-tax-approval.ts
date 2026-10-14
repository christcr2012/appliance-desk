/** Business-use approval, independent of the private synthetic tax preview.
 * A saved choice is not professional confirmation. Jurisdiction-specific CPA
 * rules, verified rates, owner customer terms and LIVE switches still apply. */
export type SetupTaxApproval = {
  setupFeeTaxTreatment: string;
  setupFeeTaxDecisionNote: string | null;
  setupFeeTaxConfirmedOn: Date | null;
  setupFeeTaxEffectiveFrom: Date | null;
  setupFeeTaxApprovedAt: Date | null;
  setupFeeTaxAdviserReference: string | null;
};
export function effectiveSetupTaxTreatment(
  settings: SetupTaxApproval | null | undefined,
  effectiveOn: Date = new Date(),
): "UNDECIDED" | "TAXABLE" | "NOT_TAXABLE" {
  if (!settings || !["TAXABLE", "NOT_TAXABLE"].includes(settings.setupFeeTaxTreatment) ||
      !settings.setupFeeTaxDecisionNote || settings.setupFeeTaxDecisionNote.trim().length < 10 ||
      !settings.setupFeeTaxAdviserReference || settings.setupFeeTaxAdviserReference.trim().length < 10 ||
      !settings.setupFeeTaxConfirmedOn || !settings.setupFeeTaxEffectiveFrom ||
      !settings.setupFeeTaxApprovedAt || !Number.isFinite(effectiveOn.getTime()) ||
      ![settings.setupFeeTaxConfirmedOn, settings.setupFeeTaxEffectiveFrom, settings.setupFeeTaxApprovedAt]
        .every(date => date instanceof Date && Number.isFinite(date.getTime())) ||
      settings.setupFeeTaxConfirmedOn > settings.setupFeeTaxApprovedAt ||
      settings.setupFeeTaxApprovedAt > effectiveOn ||
      settings.setupFeeTaxEffectiveFrom > effectiveOn) return "UNDECIDED";
  return settings.setupFeeTaxTreatment as "TAXABLE" | "NOT_TAXABLE";
}
