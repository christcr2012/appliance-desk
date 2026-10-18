// Shared steps for the integrated scenarios (tests/scenarios). These call the same domain functions the product uses;
// they only save repeating the long signing, payment and delivery sequence. Callers install the module mocks
// (@/lib/auth, @/lib/stripe, @/lib/email) themselves, because vi.mock must live in the test file.
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { sendForSignature, signAgreement } from "@/domains/agreements";
import { recordSigningBusinessReview } from "@/domains/billing/signing-business-review";
import { prepareSigningPaymentAttempt } from "@/domains/billing/signing-payment-attempts";
import { recordManualSigningPayment } from "@/domains/billing/signing-payment-manual";
import { completeJob, updateJobStatus } from "@/domains/jobs";

type Fixture = { owner: string; ids: string[]; orderFingerprint: string; customerId: string; day: string; tag: string };

export async function reviewSignAndPay(fixture: Fixture, index = 0, label = "scn") {
  const { owner, day, tag } = fixture;
  const agreementId = fixture.ids[index];
  await recordSigningBusinessReview(owner, {
    agreementId, expectedOrderFingerprint: fixture.orderFingerprint, decision: "APPROVED", effectiveFromKey: day, confirmedOnKey: day,
    taxAdviserReference: "Synthetic CPA advice for isolated test only", legalAdviserReference: "Synthetic attorney advice for isolated test only",
    termsReference: "Synthetic complete signing and refund terms", reason: "Synthetic owner attestation; no actual professional approval", acknowledged: true,
  });
  const signature = await sendForSignature(owner, agreementId);
  await signAgreement(signature.id, { signerName: "Scenario Customer", signerEmail: `${label}-${tag}@test.invalid`, ipAddress: null });
  const attempt = await prepareSigningPaymentAttempt(agreementId, "MANUAL", owner);
  const receipt = await recordManualSigningPayment({
    agreementId, attemptId: attempt.id, actingUserId: owner, method: "check", reference: `${label}-${tag}-${index}`, receivedOn: day, confirmedReceived: true,
  });
  const job = await prisma.job.findFirstOrThrow({ where: { agreementId, type: "DELIVERY" } });
  return { agreementId, receipt, jobId: job.id };
}

/** Assigns `count` new machines to the agreement's first line, starts the delivery and completes it (which hands off to billing). */
export async function deliverMachines(fixture: Fixture, agreementId: string, jobId: string, count = 2, label = "scn") {
  const { owner, day, tag } = fixture;
  const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId }, include: { lines: true } });
  await prisma.customer.update({ where: { id: agreement.customerId }, data: { stripeCustomerId: `cus_${label}_${tag}`, stripeDefaultPaymentMethodId: `pm_${label}_${tag}` } });
  await updateJobStatus(owner, jobId, "IN_PROGRESS");
  const type = await prisma.applianceType.findFirstOrThrow();
  const applianceIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const machine = await prisma.appliance.create({ data: { assetNumber: `${label.toUpperCase()}-${tag}-${agreementId.slice(-4)}-${i}`, applianceTypeId: type.id, status: "RESERVED" } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: agreement.lines[0].id, applianceId: machine.id } });
    await prisma.jobAppliance.create({ data: { jobId, applianceId: machine.id } });
    applianceIds.push(machine.id);
  }
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const completion = {
    jobId, expectedVersion: job.version, completionKey: `${label}-complete-${tag}-${agreementId.slice(-4)}`, performedOn: businessDateFromKey(day),
    completionNotes: null, results: applianceIds.map((applianceId) => ({ applianceId, result: "DELIVERED" as const })),
  };
  const result = await completeJob(owner, completion);
  return { applianceIds, completion, result };
}

/**
 * Scenarios share one throwaway database with every other test. Some product code works through global queues (billing
 * hand-offs after a delivery, provider operations that are waiting or unknown), so a scenario must not leave unfinished
 * queue rows behind for the next test file to pick up. Files run one after another, so everything created since the
 * scenario file started belongs to it.
 */
export async function purgeScenarioQueues(since: Date): Promise<void> {
  await prisma.jobBillingHandoff.deleteMany({ where: { createdAt: { gte: since } } });
  await prisma.providerOperation.deleteMany({ where: { requestedAt: { gte: since }, status: { not: "SUCCEEDED" } } });
}
