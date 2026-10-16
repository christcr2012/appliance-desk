import { createHash } from "node:crypto";
// A disposable W-22 snapshot shared by the existing waiver/terms browser
// acceptance fixtures; no new business approval or payment is inferred.
export async function attachFrozenZeroOffer(
  prisma: typeof import("../../src/lib/prisma").prisma,
  agreementId: string, serviceAddressId: string, signatureId: string,
) {
  const sourceFingerprint = "a".repeat(64);
  const line = { agreementId, serviceAddressId, version: 1,
    setupFeeCents: 0, downPaymentCents: 0, setupTaxCents: 0,
    allInCandidateCents: 0, jurisdictionEvidence: [] };
  const orderFingerprint = createHash("sha256").update(
    JSON.stringify({ sourceFingerprint, lines: [line] }),
  ).digest("hex");
  const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  await prisma.agreementSigningCharge.create({ data: {
    agreementId, serviceAddressId, version: 1, machineCount: 1,
    firstMonthRentCents: 4000, setupFeeCents: 0, downPaymentCents: 0,
    signingSubtotalCents: 0, setupFeeTaxTreatment: "UNDECIDED",
    settingsUpdatedAt: new Date(), sourceFingerprint, createdByUserId: ownerId,
    frozenAt: new Date(), frozenOrderFingerprint: orderFingerprint,
    frozenAllInCents: 0, frozenSetupTaxCents: 0,
    frozenChargeEvidence: {
      schemaVersion: 1, agreementId, serviceAddressId, agreementVersion: 1,
      sourceFingerprint, orderFingerprint, setupFeeCents: 0,
      downPaymentCents: 0, setupTaxCents: 0, allInCents: 0, jurisdictions: [],
    },
  } });
  await prisma.signatureRecord.update({ where: { id: signatureId }, data: {
    signingOrderFingerprint: orderFingerprint, signingAllInCents: 0,
    signingEvidenceVersion: 1,
  } });
}

