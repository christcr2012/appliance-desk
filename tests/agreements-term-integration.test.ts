import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getEarlyTerminationQuote,
  renewAgreement,
  requestEarlyTermination,
  setAutoRenew,
} from "@/domains/agreements/term";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const POLICY_FIELDS = {
  earlyTerminationFeeCents: null,
  earlyTerminationFeePercent: null,
  earlyTerminationFeeCapCents: null,
  earlyTerminationNoticeDays: null,
  unusedTermTreatment: null,
  autoRenewNoticeDays: null,
  autoRenewTermsVersion: null,
  renewalTermsText: null,
  terminationTermsText: null,
} as const;

const requestedOn = new Date("2026-10-03T12:00:00Z");
const renewalStart = new Date("2027-11-08T19:00:00Z");

describe.skipIf(!enabled)("fixed-term termination, renewal and auto-renew in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `term-owner-${tag}`;
  const staffId = `term-staff-${tag}`;
  const customerUserId = `term-cust-user-${tag}`;
  const customerId = `term-customer-${tag}`;
  const addressId = `term-address-${tag}`;
  const agreementIds: string[] = [];
  let originalSettings: Record<string, unknown> = {};

  async function newAgreement(overrides: Record<string, unknown> = {}) {
    const agreement = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: 12,
        startDate: new Date("2026-10-08T19:00:00Z"),
        endDate: new Date("2027-11-08T06:59:59Z"),
        nextBillingDate: new Date("2026-11-08T19:00:00Z"),
        depositCents: 5000,
        damageWaiverCents: 300,
        lateFeeGraceDays: 7,
        lateFeeCents: 1500,
        lateFeePercent: 2,
        taxRatePermille: 73,
        lines: {
          create: [
            { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3500, prepayDiscountCentsPerMonth: 500 },
            { label: "Dryer", monthlyPriceCents: 3000, listPriceCents: 3000 },
          ],
        },
        ...overrides,
      },
    });
    agreementIds.push(agreement.id);
    return agreement;
  }

  async function setPolicy(values: Record<string, unknown>) {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { ...POLICY_FIELDS, ...values },
    });
  }

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    originalSettings = Object.fromEntries(
      Object.keys(POLICY_FIELDS).map((key) => [key, (settings as Record<string, unknown>)[key]]),
    );
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, name: "Term Owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `${tag}-staff@example.test`, name: "Term Staff", role: "STAFF", emailVerified: true },
        { id: customerUserId, email: `${tag}-cust@example.test`, name: "Term Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId: customerUserId, referralCode: `T${tag.slice(0, 18)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" },
    });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: originalSettings,
    });
    const ids = agreementIds;
    await prisma.consentRecord.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, customerUserId] } } });
  });

  describe("early termination", () => {
    it("is unavailable until the owner sets the policy: no quote, and a request is refused", async () => {
      await setPolicy({});
      const agreement = await newAgreement();
      expect(await getEarlyTerminationQuote(agreement.id, requestedOn)).toBeNull();

      await setPolicy({ earlyTerminationFeeCents: 5000, earlyTerminationNoticeDays: 30, unusedTermTreatment: "CREDIT" });
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      await setPolicy({});
      await expect(requestEarlyTermination(ownerId, agreement.id, quote)).rejects.toThrow(/isn't available/);
      const unchanged = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(unchanged.terminationRequestedAt).toBeNull();
    });

    it("records the request, includes unpaid invoices in the quote, and does not end the agreement", async () => {
      await setPolicy({ earlyTerminationFeePercent: 10, earlyTerminationNoticeDays: 30, unusedTermTreatment: "CREDIT" });
      const agreement = await newAgreement();
      await prisma.invoice.create({
        data: { customerId, agreementId: agreement.id, status: "PARTIALLY_PAID", subtotalCents: 6000, amountDueCents: 6000, amountPaidCents: 2500 },
      });
      await prisma.invoice.create({
        data: { customerId, agreementId: agreement.id, status: "PAID", subtotalCents: 6000, amountDueCents: 6000, amountPaidCents: 6000 },
      });
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      expect(quote.unpaidBalanceCents).toBe(3500);
      expect(quote.remainingRentCents).toBe(72_000);
      expect(quote.feeCents).toBe(7200);

      await requestEarlyTermination(ownerId, agreement.id, quote);

      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.status).toBe("ACTIVE");
      expect(saved.terminationRequestedAt?.toISOString()).toBe(requestedOn.toISOString());
      expect(saved.terminationEffectiveOn?.toISOString()).toBe("2026-11-08T07:00:00.000Z");
      expect(saved.terminationFeeCents).toBe(7200);
      expect(saved.terminationPolicyVersion).toBe(quote.policyVersion);
      const audit = await prisma.auditLog.findMany({
        where: { entityId: agreement.id, action: "agreement.termination_requested" },
      });
      expect(audit).toHaveLength(1);
    });

    it("rejects a second request and a stale quote", async () => {
      await setPolicy({ earlyTerminationFeeCents: 5000, earlyTerminationNoticeDays: 30, unusedTermTreatment: "RETAIN" });
      const agreement = await newAgreement();
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;

      // The owner raises the fee after the quote was shown.
      await setPolicy({ earlyTerminationFeeCents: 9000, earlyTerminationNoticeDays: 30, unusedTermTreatment: "RETAIN" });
      await expect(requestEarlyTermination(ownerId, agreement.id, quote)).rejects.toThrow(/numbers changed/);
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).terminationRequestedAt).toBeNull();

      const fresh = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      await requestEarlyTermination(ownerId, agreement.id, fresh);
      await expect(requestEarlyTermination(ownerId, agreement.id, fresh)).rejects.toThrow(/already been requested/);
    });

    it("is owner/admin only, and only for an active agreement", async () => {
      await setPolicy({ earlyTerminationFeeCents: 5000, earlyTerminationNoticeDays: 30, unusedTermTreatment: "RETAIN" });
      const agreement = await newAgreement();
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      await expect(requestEarlyTermination(staffId, agreement.id, quote)).rejects.toThrow(/no longer has access/);

      const ended = await newAgreement({ status: "ENDED" });
      await expect(requestEarlyTermination(ownerId, ended.id, quote)).rejects.toThrow(/active agreement/);
    });
  });

  describe("renewal", () => {
    it("creates a linked DRAFT copy: same prices, no new deposit, no appliances, old agreement untouched", async () => {
      const old = await newAgreement();
      const { newAgreementId } = await renewAgreement(ownerId, old.id, { termMonths: 12, startOn: renewalStart });
      agreementIds.push(newAgreementId);

      const renewal = await prisma.rentalAgreement.findUniqueOrThrow({
        where: { id: newAgreementId },
        include: { lines: true },
      });
      expect(renewal.status).toBe("DRAFT");
      expect(renewal.renewedFromAgreementId).toBe(old.id);
      expect(renewal.customerId).toBe(customerId);
      expect(renewal.serviceAddressId).toBe(addressId);
      expect(renewal.termMonths).toBe(12);
      expect(renewal.depositCents).toBe(0);
      expect(renewal.damageWaiverCents).toBe(300);
      expect(renewal.lateFeeGraceDays).toBe(7);
      expect(renewal.lateFeeCents).toBe(1500);
      expect(renewal.lateFeePercent).toBe(2);
      expect(renewal.taxRatePermille).toBe(73);
      expect(renewal.paidInFullInAdvance).toBe(false);
      expect(renewal.freeMonthGranted).toBe(false);
      expect(renewal.stripeSubscriptionId).toBeNull();
      expect(renewal.lines.map((l) => [l.label, l.monthlyPriceCents, l.listPriceCents]).sort()).toEqual([
        ["Dryer", 3000, 3000],
        ["Washer", 3000, 3500],
      ]);
      expect(await prisma.applianceAssignment.count({ where: { rentalLine: { agreementId: newAgreementId } } })).toBe(0);

      const after = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: old.id } });
      expect(after.status).toBe("ACTIVE");
      expect(after.endDate?.toISOString()).toBe(old.endDate?.toISOString());
      expect(after.depositCents).toBe(5000);
    });

    it("must start the day after the term ends: overlap and gaps are rejected", async () => {
      const old = await newAgreement();
      await expect(
        renewAgreement(ownerId, old.id, { termMonths: 12, startOn: new Date("2027-11-07T19:00:00Z") }),
      ).rejects.toThrow(/day after the current term ends \(2027-11-08\)/);
      await expect(
        renewAgreement(ownerId, old.id, { termMonths: 12, startOn: new Date("2027-11-09T19:00:00Z") }),
      ).rejects.toThrow(/day after the current term ends/);
      expect(await prisma.rentalAgreement.count({ where: { renewedFromAgreementId: old.id } })).toBe(0);
    });

    it("refuses a second renewal, a month-to-month agreement, a non-active one, and staff", async () => {
      const old = await newAgreement();
      const first = await renewAgreement(ownerId, old.id, { termMonths: null, startOn: renewalStart });
      agreementIds.push(first.newAgreementId);
      await expect(renewAgreement(ownerId, old.id, { termMonths: 6, startOn: renewalStart })).rejects.toThrow(
        /already has a renewal/,
      );

      const monthly = await newAgreement({ termMonths: null, endDate: null });
      await expect(renewAgreement(ownerId, monthly.id, { termMonths: 12, startOn: renewalStart })).rejects.toThrow(
        /fixed-term/,
      );
      const ended = await newAgreement({ status: "ENDED" });
      await expect(renewAgreement(ownerId, ended.id, { termMonths: 12, startOn: renewalStart })).rejects.toThrow(
        /active agreement/,
      );
      const another = await newAgreement();
      await expect(renewAgreement(staffId, another.id, { termMonths: 12, startOn: renewalStart })).rejects.toThrow(
        /no longer has access/,
      );
      await expect(renewAgreement(ownerId, another.id, { termMonths: 0, startOn: renewalStart })).rejects.toThrow(
        /whole number of months/,
      );
    });

    it("two simultaneous renewals of one agreement create exactly one draft", async () => {
      const old = await newAgreement();
      const results = await Promise.allSettled([
        renewAgreement(ownerId, old.id, { termMonths: 12, startOn: renewalStart }),
        renewAgreement(ownerId, old.id, { termMonths: 12, startOn: renewalStart }),
        renewAgreement(ownerId, old.id, { termMonths: 12, startOn: renewalStart }),
      ]);
      const wins = results.filter((r) => r.status === "fulfilled");
      for (const win of wins) agreementIds.push((win as PromiseFulfilledResult<{ newAgreementId: string }>).value.newAgreementId);
      expect(wins).toHaveLength(1);
      expect(await prisma.rentalAgreement.count({ where: { renewedFromAgreementId: old.id } })).toBe(1);
    });
  });

  describe("auto-renew consent", () => {
    const ready = {
      autoRenewNoticeDays: 30,
      autoRenewTermsVersion: "2026-10-a",
      renewalTermsText: "Your rental renews month to month unless you cancel.",
    };

    it("is unavailable until the renewal terms exist", async () => {
      await setPolicy({});
      const agreement = await newAgreement();
      await expect(setAutoRenew(ownerId, agreement.id, { enabled: true, termsVersion: "2026-10-a" })).rejects.toThrow(
        /isn't available/,
      );
    });

    it("records consent for the current terms with a ConsentRecord, and rejects out-of-date terms", async () => {
      await setPolicy(ready);
      const agreement = await newAgreement();
      await expect(setAutoRenew(ownerId, agreement.id, { enabled: true, termsVersion: "old" })).rejects.toThrow(
        /out of date/,
      );
      await setAutoRenew(ownerId, agreement.id, { enabled: true, termsVersion: "2026-10-a" });

      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.renewalPreference).toBe("AUTO_RENEW");
      expect(saved.autoRenewTermsVersion).toBe("2026-10-a");
      expect(saved.autoRenewConsentedAt).not.toBeNull();
      const consent = await prisma.consentRecord.findMany({ where: { customerId, kind: "auto_renew" } });
      expect(consent.some((c) => (c.details as { agreementId?: string })?.agreementId === agreement.id)).toBe(true);
    });

    it("turning it off clears the consent but never ends or cancels the agreement", async () => {
      await setPolicy(ready);
      const agreement = await newAgreement();
      await setAutoRenew(ownerId, agreement.id, { enabled: true, termsVersion: "2026-10-a" });
      await setAutoRenew(ownerId, agreement.id, { enabled: false, termsVersion: "2026-10-a" });

      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.status).toBe("ACTIVE");
      expect(saved.renewalPreference).toBe("NONE");
      expect(saved.autoRenewConsentedAt).toBeNull();
      expect(saved.autoRenewTermsVersion).toBeNull();
      const records = await prisma.consentRecord.findMany({ where: { customerId, kind: "auto_renew" } });
      const mine = records.filter((c) => (c.details as { agreementId?: string })?.agreementId === agreement.id);
      expect(mine.map((c) => (c.details as { enabled: boolean }).enabled).sort()).toEqual([false, true]);
    });

    it("is owner/admin only and only for an active agreement", async () => {
      await setPolicy(ready);
      const agreement = await newAgreement();
      await expect(setAutoRenew(staffId, agreement.id, { enabled: false, termsVersion: "x" })).rejects.toThrow(
        /no longer has access/,
      );
      const ended = await newAgreement({ status: "ENDED" });
      await expect(setAutoRenew(ownerId, ended.id, { enabled: false, termsVersion: "x" })).rejects.toThrow(
        /active agreement/,
      );
    });
  });
});
