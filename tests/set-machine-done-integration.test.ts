import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ subscriptions: { retrieve: stripe.retrieve, update: stripe.update } }),
}));

import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { markSetMachineDone, planSetMachineDone, singlePriceForRemaining, singlePriceStart } from "@/domains/billing/set-machine-done";
import { businessDateFromKey } from "@/lib/business-date";

// W-21B (D-WB8 case 1), real Postgres: the customer is done with one machine of a set → single price for the rest.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe("single price for the rest (pure)", () => {
  const prepay = {
    sixMonthPrepayDiscountSetCents: 500,
    sixMonthPrepayDiscountSingleCents: 250,
    twelveMonthPrepayDiscountSetCents: 1000,
    twelveMonthPrepayDiscountSingleCents: 500,
  };
  it("uses the remaining machines' single prices less this term's discount for that many, never more than today", () => {
    expect(singlePriceForRemaining({ currentLinePriceCents: 6000, remainingTypePricesCents: [3500], termMonths: null, prepay })).toBe(3500);
    expect(singlePriceForRemaining({ currentLinePriceCents: 5000, remainingTypePricesCents: [3500], termMonths: 12, prepay })).toBe(3000);
    expect(singlePriceForRemaining({ currentLinePriceCents: 6000, remainingTypePricesCents: [3500, 3500], termMonths: null, prepay })).toBe(6000);
  });
  it("starts the day after the pickup for a give-back on the pickup day, otherwise on the decision day", () => {
    const pickup = businessDateFromKey("2026-09-10")!;
    expect(singlePriceStart(pickup, pickup).toISOString()).toBe(businessDateFromKey("2026-09-11")!.toISOString());
    expect(singlePriceStart(pickup, businessDateFromKey("2026-09-14")!).toISOString()).toBe(businessDateFromKey("2026-09-14")!.toISOString());
  });
});

describe.skipIf(!enabled)("a set machine the customer is done with (W-21B)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const ownerId = `smd-owner-${tag}`;
  const userId = `smd-user-${tag}`;
  const customerId = `smd-customer-${tag}`;
  const addressId = `smd-address-${tag}`;
  const washerType = `smd-washer-${tag}`;
  const dryerType = `smd-dryer-${tag}`;
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const day = (key: string) => businessDateFromKey(key)!;
  const now = new Date("2026-09-20T18:00:00Z");

  async function setRental(extra: { termMonths?: number | null; paidInFullInAdvance?: boolean; stripeSubscriptionId?: string; price?: number } = {}) {
    const { price = 6000, ...rest } = extra;
    const a = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        billingStartedAt: day("2026-09-01"),
        ...rest,
        lines: { create: { label: "Washer + Dryer Set", monthlyPriceCents: price, listPriceCents: price } },
      },
      include: { lines: true },
    });
    const lineId = a.lines[0]!.id;
    const machine = async (type: string) => {
      const id = `smd-unit-${applianceIds.length}-${tag}`;
      applianceIds.push(id);
      await prisma.appliance.create({ data: { id, assetNumber: `SMD${applianceIds.length}-${tag.slice(0, 6)}`, applianceTypeId: type, status: "RENTED" } });
      await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId: id } });
      await prisma.applianceCustodyEpisode.create({ data: { applianceId: id, customerId, agreementId: a.id, startEvidence: "MANUAL", startedOn: day("2026-09-01") } });
      return id;
    };
    const washer = await machine(washerType);
    const dryer = await machine(dryerType);
    return { agreementId: a.id, lineId, washer, dryer };
  }
  async function pickUp(agreementId: string, applianceId: string, on: string) {
    const job = await prisma.job.create({
      data: { type: "REMOVAL", status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId, appliances: { create: [{ applianceId }] } },
    });
    jobIds.push(job.id);
    await completeJob(ownerId, {
      jobId: job.id,
      expectedVersion: 1,
      completionKey: `smd-key-${randomUUID()}`,
      performedOn: day(on),
      completionNotes: null,
      results: [{ applianceId, result: "RETURNED" }],
    });
  }
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "SMD Owner", role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "Sam Set", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `M${tag}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Set St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.createMany({
      data: [
        { id: washerType, name: `Washer ${tag}`, slug: `smd-washer-${tag}`, monthlyPriceCents: 3500 },
        { id: dryerType, name: `Dryer ${tag}`, slug: `smd-dryer-${tag}`, monthlyPriceCents: 3500 },
      ],
    });
  });

  afterAll(async () => {
    const agreements = await prisma.rentalAgreement.findMany({ where: { customerId }, select: { id: true, lines: { select: { id: true } } } });
    const lineIds = agreements.flatMap((a) => a.lines.map((l) => l.id));
    const credits = await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } });
    await prisma.providerOperation.deleteMany({ where: { OR: [{ subjectId: { in: credits.map((c) => c.id) } }, { subjectId: { in: lineIds } }] } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityId: { in: [...applianceIds, ...jobIds, ...lineIds] } }] } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.outOfServicePeriod.deleteMany({ where: { applianceId: { in: applianceIds } } });
    // Amendments are append-only by database rule; disposable-database cleanup lifts it the same way subscription-line tests do.
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" DISABLE TRIGGER "RentalLineAmendment_append_only"'),
      prisma.rentalLineAmendment.deleteMany({ where: { rentalLineId: { in: lineIds } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" ENABLE TRIGGER "RentalLineAmendment_append_only"'),
    ]);
    await prisma.rentalLine.deleteMany({ where: { id: { in: lineIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: [washerType, dryerType] } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("given back for good on the pickup day: single price from the next day, the rest of the billed month credited, Stripe changed", async () => {
    const r = await setRental({ stripeSubscriptionId: `sub_${tag}` });
    await pickUp(r.agreementId, r.dryer, "2026-09-10");
    stripe.retrieve.mockResolvedValue({
      items: { data: [{ id: "si_1", price: { unit_amount: 6000, product: { id: "prod_1", metadata: { rentalLineId: r.lineId } } }, tax_rates: [] }] },
    });
    stripe.update.mockResolvedValue({ id: `sub_${tag}` });

    const plan = await planSetMachineDone(r.dryer, day("2026-09-10"), now);
    expect(plan).toMatchObject({ eligible: true, oldPriceCents: 6000, newPriceCents: 3500 });
    const result = await markSetMachineDone(ownerId, { applianceId: r.dryer, decidedOn: day("2026-09-10"), now });

    expect(await prisma.rentalLine.findUniqueOrThrow({ where: { id: r.lineId } })).toMatchObject({ monthlyPriceCents: 3500 });
    const amendment = await prisma.rentalLineAmendment.findFirstOrThrow({ where: { rentalLineId: r.lineId } });
    expect(amendment).toMatchObject({ previousMonthlyPriceCents: 6000, newMonthlyPriceCents: 3500, pendingDeliveryId: null });
    expect(await prisma.applianceAssignment.findFirstOrThrow({ where: { applianceId: r.dryer } })).toMatchObject({
      unassignReason: expect.stringMatching(/^Taken off: customer done with it/),
    });
    // $25.00 a month less × Sept 11–30 (20 days) ÷ 30 = $16.67; no out-of-service days (decided for the pickup day).
    const setCredit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId, sourceType: "SET_SINGLE_PRICE", sourceId: amendment.id } });
    expect(setCredit.amountCents).toBe(1667);
    expect(setCredit.reason).toMatch(/^Credit – single price for the washer .* – 20 days$/);
    expect(await prisma.outOfServicePeriod.findFirstOrThrow({ where: { applianceId: r.dryer } })).toMatchObject({ endReason: "CLOSED_BY_OWNER", creditId: null });
    expect(stripe.update).toHaveBeenCalledWith(
      `sub_${tag}`,
      expect.objectContaining({ proration_behavior: "none", items: [expect.objectContaining({ id: "si_1", price_data: expect.objectContaining({ unit_amount: 3500 }) })] }),
      expect.anything(),
    );
    expect(await prisma.providerOperation.findFirstOrThrow({ where: { idempotencyKey: `subscription-line-reprice-${amendment.id}` } })).toMatchObject({ status: "SUCCEEDED" });
    expect(result.message).toMatch(/\$35 a month \(was \$60\)/);
  });

  it("decided four days later: those days are out-of-service days, single price from the decision day", async () => {
    const r = await setRental();
    await pickUp(r.agreementId, r.dryer, "2026-09-10");
    await markSetMachineDone(ownerId, { applianceId: r.dryer, decidedOn: day("2026-09-14"), now });
    const period = await prisma.outOfServicePeriod.findFirstOrThrow({ where: { applianceId: r.dryer } });
    const oos = await prisma.customerCredit.findUniqueOrThrow({ where: { id: period.creditId! } });
    expect(oos.amountCents).toBe(400); // dryer's $30 share × Sept 10–13 (4 days) ÷ 30
    const amendment = await prisma.rentalLineAmendment.findFirstOrThrow({ where: { rentalLineId: r.lineId } });
    const setCredit = await prisma.customerCredit.findFirstOrThrow({ where: { sourceType: "SET_SINGLE_PRICE", sourceId: amendment.id } });
    expect(setCredit.amountCents).toBe(1417); // $25 × Sept 14–30 (17 days) ÷ 30 = 1416.67
  });

  it("a 12-month set keeps the single-machine prepay discount; paid-in-full gets no automatic credit; a lone machine is refused", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    const setPrice = 6000 - settings.twelveMonthPrepayDiscountSetCents;
    const r = await setRental({ termMonths: 12, price: setPrice });
    await pickUp(r.agreementId, r.dryer, "2026-09-10");
    const plan = await planSetMachineDone(r.dryer, day("2026-09-10"), now);
    expect(plan).toMatchObject({ newPriceCents: Math.min(setPrice, 3500 - settings.twelveMonthPrepayDiscountSingleCents) });

    const paid = await setRental({ paidInFullInAdvance: true });
    await pickUp(paid.agreementId, paid.dryer, "2026-09-10");
    await markSetMachineDone(ownerId, { applianceId: paid.dryer, decidedOn: day("2026-09-10"), now });
    expect(await prisma.rentalLine.findUniqueOrThrow({ where: { id: paid.lineId } })).toMatchObject({ monthlyPriceCents: 3500 });
    expect(await prisma.customerCredit.count({ where: { customerId, sourceType: "SET_SINGLE_PRICE", sourceId: { in: (await prisma.rentalLineAmendment.findMany({ where: { rentalLineId: paid.lineId } })).map((a) => a.id) } } })).toBe(0);

    // The washer of the paid rental is now alone on its line: taking it is a repair or an ending, not a set change.
    await expect(markSetMachineDone(ownerId, { applianceId: paid.washer, decidedOn: day("2026-09-12"), now })).rejects.toThrow(/no open repair period/);
    await expect(markSetMachineDone(ownerId, { applianceId: r.dryer, decidedOn: day("2026-09-09"), now })).rejects.toThrow(/on or after/);
    await expect(markSetMachineDone(ownerId, { applianceId: r.dryer, decidedOn: day("2026-09-25"), now })).rejects.toThrow(/future/);
  });
});
