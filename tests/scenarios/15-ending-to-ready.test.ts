// PLAN scenario 15 (BATCH-F WU-F4): every way a rental can end (term end, early return, agreed termination, cancellation)
// creates the same pickup draft and ends in the same chain: pickup -> awaiting inspection -> inspection -> cleaning ->
// available (or maintenance with exactly one repair draft). Real domain functions on the disposable Postgres.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { openCustodyEpisodeInTx } from "@/domains/inventory/custody";
import { cancelAgreement } from "@/domains/agreements";
import { decideEndingPickup, createPickupVisitForAgreement } from "@/domains/agreements/pickup-draft";
import { closeFullyReturnedAgreements } from "@/domains/agreements/returns";
import { getEarlyTerminationQuote, requestEarlyTermination } from "@/domains/agreements/term";
import { runDueTerminations } from "@/domains/agreements/termination-execution";
import { buildTermsSnapshot } from "@/domains/agreements/terms-snapshot";
import { getInspectionChecklist, recordApplianceInspection } from "@/domains/inventory/guided-actions";
import { markCleaningDone } from "@/domains/inventory/cleaning";
import { seedTaxReadyContext } from "../helpers/tax-ready";
import { purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("scenario 15: every ending ends in the same ready-or-repair chain", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `s15-owner-${tag}`;
  const userId = `s15-user-${tag}`;
  const customerId = `s15-customer-${tag}`;
  const addressId = `s15-address-${tag}`;
  const typeId = `s15-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const owner = { userId: ownerId, kind: "team" as const };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `${tag}-o@example.test`, name: "S15 Owner", role: "OWNER", emailVerified: true } });
    await prisma.user.create({ data: { id: userId, email: `${tag}-c@example.test`, name: "S15 Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `S${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "15 Test St", city: "Greeley", zip: "80631" } });
    await seedTaxReadyContext(addressId, { rateMilliPercent: 7_000 });
    await prisma.applianceType.create({ data: { id: typeId, name: `S15 ${tag}`, slug: `s15-${tag}` } });
  });

  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    const invoices = (await prisma.invoice.findMany({ where: { customerId }, select: { id: true } })).map((i) => i.id);
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.outOfServicePeriod.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { applianceId: { in: applianceIds } } });
    const allJobs = (await prisma.job.findMany({ where: { OR: [{ agreementId: { in: agreementIds } }, { id: { in: jobIds } }] }, select: { id: true } })).map((j) => j.id);
    await prisma.job.deleteMany({ where: { id: { in: allJobs } } }).catch(() => undefined);
  });

  /** An ACTIVE, delivered rental with one machine at the customer's. */
  async function rental(label: string, extra: Record<string, unknown> = {}) {
    const agreementId = `s15-${label}-${tag}`;
    agreementIds.push(agreementId);
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE", termMonths: 12,
        startDate: new Date("2026-10-08T19:00:00Z"), endDate: new Date("2027-11-08T06:59:59Z"),
        nextBillingDate: new Date("2026-11-08T19:00:00Z"), taxRateMilliPercent: 7000,
        firstDeliveredOn: new Date("2026-10-08T19:00:00Z"),
        lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } },
        ...extra,
      },
    });
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    const setupId = `s15-setup-${label}-${tag}`;
    jobIds.push(setupId);
    await prisma.job.create({ data: { id: setupId, type: "DELIVERY", status: "COMPLETED", customerId, serviceAddressId: addressId, agreementId } });
    const applianceId = `s15-unit-${label}-${tag}`;
    applianceIds.push(applianceId);
    await prisma.appliance.create({ data: { id: applianceId, assetNumber: `S15${label}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED" } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId } });
    await prisma.$transaction((tx) =>
      openCustodyEpisodeInTx(tx, { applianceId, customerId, serviceAddressId: addressId, agreementId, startedOn: new Date("2026-10-08T19:00:00Z"), startJobId: setupId }),
    );
    return { agreementId, applianceId };
  }

  const statusOf = async (id: string) => (await prisma.appliance.findUniqueOrThrow({ where: { id } })).status;
  const openPickup = (agreementId: string) =>
    prisma.job.findMany({ where: { agreementId, type: "REMOVAL", status: { not: "CANCELLED" } }, include: { appliances: true } });

  /** Pickup drafted -> machine returned -> inspected -> cleaned. Returns the chain of machine statuses seen. */
  async function runChain(agreementId: string, applianceId: string, pass: boolean) {
    const pickups = await openPickup(agreementId);
    expect(pickups).toHaveLength(1);
    expect(pickups[0].scheduledAt).toBeNull();
    expect(pickups[0].appliances.map((a) => a.applianceId)).toEqual([applianceId]);
    const chain: string[] = [];
    await prisma.job.update({ where: { id: pickups[0].id }, data: { status: "IN_PROGRESS" } });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: pickups[0].id } });
    await completeJob(ownerId, {
      jobId: job.id, expectedVersion: job.version, completionKey: `s15-${randomUUID()}`,
      performedOn: businessDateFromKey(businessDateKey(new Date())), completionNotes: null,
      results: [{ applianceId, result: "RETURNED" as const }],
    });
    chain.push(await statusOf(applianceId));
    const checklist = await getInspectionChecklist();
    await recordApplianceInspection(ownerId, applianceId, {
      expectedChecklistVersionId: checklist.versionId,
      answers: checklist.items.map((_, i) => pass || i !== 0),
    });
    chain.push(await statusOf(applianceId));
    if (pass) {
      await markCleaningDone(ownerId, applianceId);
      chain.push(await statusOf(applianceId));
    } else {
      expect(await prisma.job.count({ where: { type: "MAINTENANCE_VISIT", status: { not: "CANCELLED" }, appliances: { some: { applianceId } } } })).toBe(1);
    }
    return chain;
  }

  it("term end, early return, agreed termination and cancellation all follow one chain to Available", async () => {
    // Term end: the owner chooses Pickup; the rental ends once everything is back.
    const term = await rental("term");
    expect((await decideEndingPickup(ownerId, term.agreementId)).created).toBe(true);
    const termChain = await runChain(term.agreementId, term.applianceId, true);
    await closeFullyReturnedAgreements(new Date("2027-12-01T12:00:00Z"));
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: term.agreementId } })).status).toBe("ENDED");

    // Early return: the owner books the pickup, the customer's machine comes back.
    const early = await rental("early");
    expect((await createPickupVisitForAgreement(ownerId, early.agreementId)).created).toBe(true);
    const earlyChain = await runChain(early.agreementId, early.applianceId, true);

    // Agreed termination: the quote is frozen, the pickup is drafted when it is decided, and it ends on its date.
    const terminated = await rental("termn");
    await prisma.rentalAgreement.update({
      where: { id: terminated.agreementId },
      data: {
        termsSnapshot: JSON.parse(JSON.stringify(buildTermsSnapshot({
          earlyTerminationFeeCents: 0, earlyTerminationNoticeDays: 30, unusedTermTreatment: "CREDIT",
          terminationTermsText: "Ending early costs the fee in your agreement.", autoRenewNoticeDays: 30,
          renewalTermsText: "Your rental renews month to month unless you cancel.",
        }, undefined, new Date()))),
      },
    });
    const requestedOn = new Date("2026-10-17T12:00:00Z");
    const quote = (await getEarlyTerminationQuote(terminated.agreementId, requestedOn))!;
    await requestEarlyTermination(owner, terminated.agreementId, quote, { now: requestedOn });
    const termnChain = await runChain(terminated.agreementId, terminated.applianceId, true);
    await runDueTerminations(new Date(quote.effectiveOn.getTime() + 86_400_000));
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: terminated.agreementId } })).status).toBe("ENDED");

    // Cancellation of a delivered rental: the machine must not be left waiting with no pickup and no one told.
    const cancelled = await rental("cancel");
    await cancelAgreement(ownerId, cancelled.agreementId);
    expect(await statusOf(cancelled.applianceId)).toBe("AWAITING_PICKUP");
    const cancelChain = await runChain(cancelled.agreementId, cancelled.applianceId, true);

    // Same chain for every path, nothing skipped.
    for (const chain of [termChain, earlyChain, termnChain, cancelChain]) {
      expect(chain).toEqual(["AWAITING_INSPECTION", "CLEANING", "AVAILABLE"]);
    }
  });

  it("a failed inspection sends the machine to Maintenance with exactly one repair draft, on any path", async () => {
    const cancelled = await rental("cfail");
    await cancelAgreement(ownerId, cancelled.agreementId);
    expect(await runChain(cancelled.agreementId, cancelled.applianceId, false)).toEqual(["AWAITING_INSPECTION", "MAINTENANCE"]);

    const early = await rental("efail");
    await createPickupVisitForAgreement(ownerId, early.agreementId);
    expect(await runChain(early.agreementId, early.applianceId, false)).toEqual(["AWAITING_INSPECTION", "MAINTENANCE"]);
  });

  it("cancelling a rental with nothing delivered drafts no pickup", async () => {
    const agreementId = `s15-undelivered-${tag}`;
    agreementIds.push(agreementId);
    await prisma.rentalAgreement.create({
      data: { id: agreementId, customerId, serviceAddressId: addressId, status: "DRAFT", termMonths: 12, taxRateMilliPercent: 7000, lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } } },
    });
    await cancelAgreement(ownerId, agreementId);
    expect(await openPickup(agreementId)).toHaveLength(0);
  });
});
