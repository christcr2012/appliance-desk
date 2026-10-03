import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getEarlyTerminationQuote,
  renewAgreement,
  requestEarlyTermination,
  setAutoRenew,
  type TermActor,
} from "@/domains/agreements/term";
import { sendForSignature, signAgreement } from "@/domains/agreements";
import { buildTermsSnapshot, type TermsValues } from "@/domains/agreements/terms-snapshot";

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

const TERMS_TEXT = "Ending early costs the fee in your agreement.";
const RENEW_TEXT = "Your rental renews month to month unless you cancel.";
const flat5000: TermsValues = {
  earlyTerminationFeeCents: 5000,
  earlyTerminationNoticeDays: 30,
  unusedTermTreatment: "CREDIT",
  terminationTermsText: TERMS_TEXT,
  autoRenewNoticeDays: 30,
  renewalTermsText: RENEW_TEXT,
};
const renewalStart = new Date("2027-11-08T19:00:00Z");

describe.skipIf(!enabled)("fixed-term termination, renewal and auto-renew in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `term-owner-${tag}`;
  const staffId = `term-staff-${tag}`;
  const customerUserId = `term-cust-user-${tag}`;
  const customerId = `term-customer-${tag}`;
  const otherUserId = `term-other-user-${tag}`;
  const otherCustomerId = `term-other-customer-${tag}`;
  const owner: TermActor = { userId: `term-owner-${tag}`, kind: "team" };
  const staff: TermActor = { userId: `term-staff-${tag}`, kind: "team" };
  const customer: TermActor = { userId: `term-cust-user-${tag}`, kind: "customer" };
  const otherCustomer: TermActor = { userId: otherUserId, kind: "customer" };
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
        taxRateMilliPercent: 7300,
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

  /** Stands in for sendForSignature: freezes these terms onto the agreement. */
  async function lockTerms(agreementId: string, values: TermsValues, override?: unknown) {
    await prisma.rentalAgreement.update({
      where: { id: agreementId },
      data: { termsSnapshot: JSON.parse(JSON.stringify(buildTermsSnapshot(values, override, new Date()))) },
    });
  }

  async function lockedAgreement(values: TermsValues = flat5000, overrides: Record<string, unknown> = {}) {
    const agreement = await newAgreement(overrides);
    await lockTerms(agreement.id, values);
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
        { id: otherUserId, email: `${tag}-other@example.test`, name: "Other Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: otherCustomerId, userId: otherUserId, referralCode: `O${tag.slice(0, 18)}` },
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
    await prisma.signatureRecord.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, customerUserId, otherUserId] } } });
  });

  describe("early termination uses the terms the agreement is locked to", () => {
    it("is unavailable for an agreement that was never signed with early-ending terms", async () => {
      const agreement = await newAgreement(); // no snapshot: nothing was agreed
      expect(await getEarlyTerminationQuote(agreement.id, requestedOn)).toBeNull();
      const other = await lockedAgreement(flat5000);
      const quote = (await getEarlyTerminationQuote(other.id, requestedOn))!;
      await expect(requestEarlyTermination(owner, agreement.id, quote, { now: requestedOn })).rejects.toThrow(
        /isn't available/,
      );
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).terminationRequestedAt).toBeNull();
    });

    it("an agreement signed without complete terms stays unavailable even if the owner completes them later", async () => {
      const incomplete = { ...flat5000, terminationTermsText: null };
      const agreement = await lockedAgreement(incomplete);
      await setPolicy({ ...flat5000 });
      expect(await getEarlyTerminationQuote(agreement.id, requestedOn)).toBeNull();
    });

    it("changing the system-wide terms later never changes an existing agreement's quote", async () => {
      const agreement = await lockedAgreement({ ...flat5000, earlyTerminationFeeCents: 5000 });
      await setPolicy({ ...flat5000, earlyTerminationFeeCents: 99_000, earlyTerminationNoticeDays: 90, unusedTermTreatment: "RETAIN" });
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      expect(quote.feeCents).toBe(5000);
      expect(quote.unusedTermTreatment).toBe("CREDIT");
      expect(quote.effectiveOn.toISOString()).toBe("2026-11-08T07:00:00.000Z"); // 30 days' notice, not 90
      await requestEarlyTermination(owner, agreement.id, quote, { now: requestedOn });
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).terminationFeeCents).toBe(5000);
    });

    it("a per-customer override beats the system-wide terms and is what gets locked", async () => {
      const agreement = await newAgreement();
      await lockTerms(agreement.id, flat5000, { earlyTerminationFeeCents: 0, earlyTerminationNoticeDays: 14 });
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      expect(quote.feeCents).toBe(0);
      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect((saved.termsSnapshot as { source: string }).source).toBe("CUSTOM");
    });

    it("records the request, includes unpaid invoices in the quote, and does not end the agreement", async () => {
      const agreement = await lockedAgreement({ ...flat5000, earlyTerminationFeeCents: null, earlyTerminationFeePercent: 10 });
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

      await requestEarlyTermination(owner, agreement.id, quote, { now: requestedOn });

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

    it("the request time comes from the server: a backdated or altered quote cannot get through", async () => {
      const agreement = await lockedAgreement({ ...flat5000, earlyTerminationNoticeDays: 30 });
      const genuine = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;

      // Pretending the request was made months ago to skip the notice period.
      const backdated = { ...genuine, requestedOn: new Date("2026-01-01T12:00:00Z"), effectiveOn: new Date("2026-02-08T07:00:00Z") };
      await expect(requestEarlyTermination(customer, agreement.id, backdated, { now: requestedOn })).rejects.toThrow(
        /numbers changed/,
      );
      // Only the timestamp altered: accepted, but the server's time is what is stored.
      const timestampOnly = { ...genuine, requestedOn: new Date("2026-01-01T12:00:00Z") };
      await requestEarlyTermination(customer, agreement.id, timestampOnly, { now: requestedOn });
      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.terminationRequestedAt?.toISOString()).toBe(requestedOn.toISOString());
    });

    it("rejects a second request and a stale quote", async () => {
      const agreement = await lockedAgreement({ ...flat5000, earlyTerminationFeeCents: 5000, unusedTermTreatment: "RETAIN" });
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      // The agreement changes after the quote was shown (a billing anniversary moves).
      await prisma.rentalAgreement.update({ where: { id: agreement.id }, data: { nextBillingDate: new Date("2026-11-09T19:00:00Z") } });
      await expect(requestEarlyTermination(owner, agreement.id, quote, { now: requestedOn })).rejects.toThrow(/numbers changed/);
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).terminationRequestedAt).toBeNull();

      const fresh = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      await requestEarlyTermination(owner, agreement.id, fresh, { now: requestedOn });
      await expect(requestEarlyTermination(owner, agreement.id, fresh, { now: requestedOn })).rejects.toThrow(/already been requested/);
    });

    it("who can act: owner/admin on any agreement, a customer only on their own, never staff or a deactivated person", async () => {
      const agreement = await lockedAgreement();
      const quote = (await getEarlyTerminationQuote(agreement.id, requestedOn))!;
      await expect(requestEarlyTermination(staff, agreement.id, quote, { now: requestedOn })).rejects.toThrow(/no longer has access/);
      await expect(requestEarlyTermination(otherCustomer, agreement.id, quote, { now: requestedOn })).rejects.toThrow(
        /Couldn't find that rental agreement/,
      );
      // A customer id used as a "team" actor is refused too.
      await expect(
        requestEarlyTermination({ userId: customer.userId, kind: "team" }, agreement.id, quote, { now: requestedOn }),
      ).rejects.toThrow(/no longer has access/);
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).terminationRequestedAt).toBeNull();

      await prisma.user.update({ where: { id: customer.userId }, data: { archivedAt: new Date() } });
      await expect(requestEarlyTermination(customer, agreement.id, quote, { now: requestedOn })).rejects.toThrow(/no longer has access/);
      await prisma.user.update({ where: { id: customer.userId }, data: { archivedAt: null } });

      await requestEarlyTermination(customer, agreement.id, quote, { now: requestedOn });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: agreement.id, action: "agreement.termination_requested" },
      });
      expect(audit.userId).toBe(customer.userId);
      expect((audit.newValue as { requestedBy: string }).requestedBy).toBe("customer");
    });

    it("only for an active agreement", async () => {
      const ended = await lockedAgreement(flat5000, { status: "ENDED" });
      const quote = (await getEarlyTerminationQuote(ended.id, requestedOn))!;
      await expect(requestEarlyTermination(owner, ended.id, quote, { now: requestedOn })).rejects.toThrow(/active agreement/);
    });
  });

  describe("terms are frozen when the agreement is sent for signing", () => {
    async function draft() {
      return newAgreement({ status: "DRAFT", startDate: null, endDate: null, nextBillingDate: null });
    }

    it("sending for signature stores the current terms; later changes to the settings do not touch it", async () => {
      await setPolicy({ ...flat5000 });
      const agreement = await draft();
      const signature = await sendForSignature(ownerId, agreement.id);
      

      const sent = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      const snapshot = sent.termsSnapshot as { source: string; termination: { feeCents: number; termsText: string } | null; autoRenew: { noticeDays: number } | null };
      expect(sent.status).toBe("AWAITING_SIGNATURE");
      expect(snapshot.source).toBe("SYSTEM");
      expect(snapshot.termination).toMatchObject({ feeCents: 5000, termsText: TERMS_TEXT });
      expect(snapshot.autoRenew).toMatchObject({ noticeDays: 30 });

      await setPolicy({ ...flat5000, earlyTerminationFeeCents: 77_000, terminationTermsText: "New wording" });
      await signAgreement(signature.id, { signerName: "Term Customer", signerEmail: "c@example.test", ipAddress: null });
      const signed = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(signed.status).toBe("ACTIVE");
      expect(signed.termsSnapshot).toEqual(sent.termsSnapshot);
    });

    it("uses the owner's per-customer terms when set, and locks nothing for month-to-month", async () => {
      await setPolicy({ ...flat5000 });
      const custom = await draft();
      await prisma.rentalAgreement.update({
        where: { id: custom.id },
        data: { termsOverride: { earlyTerminationFeeCents: 1000, terminationTermsText: "Special terms for this customer." } },
      });
      await sendForSignature(ownerId, custom.id);
      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: custom.id } });
      expect(saved.termsSnapshot).toMatchObject({
        source: "CUSTOM",
        termination: { feeCents: 1000, termsText: "Special terms for this customer.", noticeDays: 30 },
      });

      const monthly = await newAgreement({ status: "DRAFT", termMonths: null, startDate: null, endDate: null, nextBillingDate: null });
      await sendForSignature(ownerId, monthly.id);
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: monthly.id } })).termsSnapshot).toBeNull();
    });

    it("with no policy set at that moment, nothing is agreed and ending early stays unavailable", async () => {
      await setPolicy({});
      const agreement = await draft();
      await sendForSignature(ownerId, agreement.id);
      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.termsSnapshot).toMatchObject({ termination: null, autoRenew: null });
      await prisma.rentalAgreement.update({ where: { id: agreement.id }, data: { status: "ACTIVE", endDate: new Date("2027-11-08T06:59:59Z"), nextBillingDate: new Date("2026-11-08T19:00:00Z") } });
      expect(await getEarlyTerminationQuote(agreement.id, requestedOn)).toBeNull();
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
      expect(renewal.startDate?.toISOString()).toBe("2027-11-08T07:00:00.000Z");
      expect(renewal.customerId).toBe(customerId);
      expect(renewal.serviceAddressId).toBe(addressId);
      expect(renewal.termMonths).toBe(12);
      expect(renewal.depositCents).toBe(0);
      expect(renewal.damageWaiverCents).toBe(300);
      expect(renewal.lateFeeGraceDays).toBe(7);
      expect(renewal.lateFeeCents).toBe(1500);
      expect(renewal.lateFeePercent).toBe(2);
      expect(renewal.taxRateMilliPercent).toBe(7300);
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

    it("signing a renewal early keeps its agreed start date instead of starting it on the signing day", async () => {
      await setPolicy({ ...flat5000 });
      const old = await newAgreement();
      const { newAgreementId } = await renewAgreement(ownerId, old.id, { termMonths: 12, startOn: renewalStart });
      agreementIds.push(newAgreementId);
      const signature = await sendForSignature(ownerId, newAgreementId);
      await signAgreement(signature.id, { signerName: "Term Customer", signerEmail: "c@example.test", ipAddress: null });
      const signed = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: newAgreementId } });
      expect(signed.status).toBe("ACTIVE");
      expect(signed.startDate?.toISOString()).toBe("2027-11-08T07:00:00.000Z");
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

  describe("auto-renew consent uses the terms the agreement was signed with", () => {
    const version = buildTermsSnapshot(flat5000, null, new Date()).autoRenew!.termsVersion;

    it("is unavailable for an agreement signed without renewal terms", async () => {
      const agreement = await lockedAgreement({ ...flat5000, renewalTermsText: null });
      await expect(setAutoRenew(owner, agreement.id, { enabled: true, termsVersion: version })).rejects.toThrow(
        /isn't available/,
      );
    });

    it("records consent for the signed-with terms with a ConsentRecord, and rejects any other version", async () => {
      const agreement = await lockedAgreement();
      await expect(setAutoRenew(owner, agreement.id, { enabled: true, termsVersion: "old" })).rejects.toThrow(
        /out of date/,
      );
      // Rewording the system-wide terms later does not make this agreement's version "out of date".
      await setPolicy({ ...flat5000, renewalTermsText: "Different wording entirely." });
      await setAutoRenew(customer, agreement.id, { enabled: true, termsVersion: version });

      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.renewalPreference).toBe("AUTO_RENEW");
      expect(saved.autoRenewTermsVersion).toBe(version);
      expect(saved.autoRenewConsentedAt).not.toBeNull();
      const consent = await prisma.consentRecord.findMany({ where: { customerId, kind: "auto_renew" } });
      const mine = consent.find((c) => (c.details as { agreementId?: string })?.agreementId === agreement.id);
      expect(mine?.details).toMatchObject({ recordedByUserId: customer.userId, recordedBy: "customer" });
    });

    it("turning it off clears the consent but never ends or cancels the agreement", async () => {
      const agreement = await lockedAgreement();
      await setAutoRenew(owner, agreement.id, { enabled: true, termsVersion: version });
      await setAutoRenew(owner, agreement.id, { enabled: false, termsVersion: version });

      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.status).toBe("ACTIVE");
      expect(saved.renewalPreference).toBe("NONE");
      expect(saved.autoRenewConsentedAt).toBeNull();
      expect(saved.autoRenewTermsVersion).toBeNull();
      const records = await prisma.consentRecord.findMany({ where: { customerId, kind: "auto_renew" } });
      const mine = records.filter((c) => (c.details as { agreementId?: string })?.agreementId === agreement.id);
      expect(mine.map((c) => (c.details as { enabled: boolean }).enabled).sort()).toEqual([false, true]);
    });

    it("a customer can only change their own agreement; staff and other customers cannot; only active agreements", async () => {
      const agreement = await lockedAgreement();
      await expect(setAutoRenew(staff, agreement.id, { enabled: false, termsVersion: "x" })).rejects.toThrow(
        /no longer has access/,
      );
      await expect(setAutoRenew(otherCustomer, agreement.id, { enabled: true, termsVersion: version })).rejects.toThrow(
        /Couldn't find that rental agreement/,
      );
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).renewalPreference).toBeNull();
      const ended = await lockedAgreement(flat5000, { status: "ENDED" });
      await expect(setAutoRenew(owner, ended.id, { enabled: false, termsVersion: "x" })).rejects.toThrow(
        /active agreement/,
      );
    });
  });
});
