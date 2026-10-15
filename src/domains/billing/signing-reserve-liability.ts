import { verifySigningV2Extension, type SigningV2Extension } from "./signing-v2-lines";

/** Only a SETTLED exact frozen obligation may fund a refundable reserve liability. */
export function signedReserveAmount(input: {
  agreementId: string; evidenceVersion: number; componentEvidence: unknown;
  setupFeeCents: number; setupTaxCents: number;
  downPaymentCents: number; totalCents: number;
  agreementDepositCents: number;
}): number {
  if (input.evidenceVersion === 1) {
    if (input.componentEvidence !== null && input.componentEvidence !== undefined)
      throw new Error("Legacy signed obligations cannot carry new reserve components.");
    if (input.agreementDepositCents > 0)
      throw new Error("A legacy signing obligation cannot settle a commercial reserve.");
    return 0;
  }
  if (input.evidenceVersion !== 2 || !input.componentEvidence)
    throw new Error("Unrecognized signed money version requires finance review.");
  const extension = verifySigningV2Extension(
    input.componentEvidence as SigningV2Extension, { ...input, allInCents: input.totalCents });
  const item = extension.components.find(row => row.category === "COMMERCIAL_RESERVE");
  if (!item || item.amountCents !== input.agreementDepositCents ||
      !Number.isSafeInteger(input.agreementDepositCents) ||
      input.agreementDepositCents < 0)
    throw new Error("Reserve liability amount differs from accepted signed terms.");
  return item.amountCents;
}
