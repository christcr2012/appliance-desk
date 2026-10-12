/** W-22C6B: the customer accepts only the immutable evidence offered by this link. */
export type SigningOfferProof = {
  signingOrderFingerprint: string | null;
  signingAllInCents: number | null;
  signingEvidenceVersion: number | null;
};
export type FrozenOfferLine = {
  orderFingerprint: string;
  allInCents: number;
  schemaVersion: 1;
};
export function offerMatchesFrozenEvidence(
  offer: SigningOfferProof | null,
  line: FrozenOfferLine | undefined,
): boolean {
  return Boolean(offer && line &&
    /^[a-f0-9]{64}$/.test(line.orderFingerprint) &&
    Number.isSafeInteger(line.allInCents) && line.allInCents >= 0 &&
    offer.signingOrderFingerprint === line.orderFingerprint &&
    offer.signingAllInCents === line.allInCents &&
    offer.signingEvidenceVersion === line.schemaVersion);
}
