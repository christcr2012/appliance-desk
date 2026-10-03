import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  update: vi.fn(),
  retrieve: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: { update: stripeMock.update, retrieve: stripeMock.retrieve, cancel: stripeMock.cancel },
  }),
}));

import { prisma } from "@/lib/prisma";
import { runAutoRenewals } from "@/domains/agreements/auto-renew";
import { runDueTerminations } from "@/domains/agreements/termination-execution";
import { startRenewalIfDue } from "@/domains/agreements/renewal-start";
import { setAutoRenew } from "@/domains/agreements/term";
import { syncTerminationEnd } from "@/domains/billing/subscription-term";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const termEnd = new Date("2027-11-08T06:59:59Z");
const renewalStart = new Date("2027-11-08T07:00:00Z");
const windowClosed = new Date("2027-09-01T12:00:00Z");
const windowOpen = new Date("2027-10-20T12:00:00Z");
const afterTerm = new Date("2027-11-09T12:00:00Z");
const effectiveOn = new Date("2027-03-08T07:00:00Z");
const beforeEnding = new Date("2027-03-01T12:00:00Z");
const onEnding = new Date("2027-03-08T13:00:00Z");

const snapshot = {
  shape: 1,
  source: "SYSTEM",
  capturedAt: "2026-11-01T00:00:00Z",
  termination: null,
  autoRenew: { noticeDays: 30, termsText: "Renews month to month.", termsVersion: "ar-test" },
};

describe.skipIf(!enabled)("auto-renew and agreed early endings are carried out", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `ar-user-${tag}`;
  const customerId = `ar-customer-${tag}`;
  const addressId = `ar-address-${tag}`;
  const ids: string[] = [];

  async function agreement(
    data: Partial<{
      termMonths: number | null;
      endDate: Date | null;
      renewalPreference: string | null;
      terminationRequestedAt: Date | null;
      terminationEffectiveOn: Date | null;
      terminationFeeCents: number | null;
      paidInFullInAdvance: boolean;
      sub: boolean;
    }> = {},
  ) {
    const n = ids.length;
    const created = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: data.termMonths === undefined ? 12 : data.termMonths,
        startDate: new Date("2026-11-08T07:00:00Z"),
        endDate: data.endDate === undefined ? termEnd : data.endDate,
        stripeSubscriptionId: data.sub === false ? null : `sub_${tag}_${n}`,
        renewalPreference: data.renewalPreference === undefined ? "AUTO_RENEW" : data.renewalPreference,
        autoRenewConsentedAt: data.renewalPreference === "NONE" ? null : new Date("2026-11-08T08:00:00Z"),
        autoRenewTermsVersion: data.renewalPreference === "NONE" ? null : "ar-test",
        termsSnapshot: snapshot,
        terminationRequestedAt: data.terminationRequestedAt ?? null,
        terminationEffectiveOn: data.terminationEffectiveOn ?? null,
        terminationFeeCents: data.terminationFeeCents ?? null,
        terminationPolicyVersion: data.terminationEffectiveOn ? "tp-test" : null,
        paidInFullInAdvance: data.paidInFullInAdvance ?? false,
        lines: {
          create: [
            { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 },
            { label: "Dryer", monthlyPriceCents: 3000, listPriceCents: 3000 },
          ],
        },
      },
    });
    ids.push(created.id);
    return created;
  }

  const get = (id: string) => prisma.rentalAgreement.findUniqueOrThrow({ where: { id } });
  const renewalsOf = (id: string) =>
    prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: id }, include: { lines: true } });

  beforeEach(() => {
    stripeMock.update.mockReset().mockImplementation(async (id: string) => ({ id }));
    stripeMock.retrieve.mockReset();
    stripeMock.cancel.mockReset().mockImplementation(async (id: string) => ({ id }));
  });

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${tag}-c@example.test`, name: "AR Customer", role: "CUSTOMER", emailVerified: true },
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `A${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" },
    });
  });

  afterAll(async () => {
    const renewals = await prisma.rentalAgreement.findMany({
      where: { renewedFromAgreementId: { in: ids } },
      select: { id: true },
    });
    const all = [...ids, ...renewals.map((r) => r.id)];
    const invoices = await prisma.invoice.findMany({ where: { agreementId: { in: all } }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: all } }, { entityId: { in: invoices.map((i) => i.id) } }] },
    });
    await prisma.providerOperation.deleteMany({ where: { subjectId: { in: all } } });
    await prisma.invoice.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.consentRecord.deleteMany({ where: { customerId } });
    await prisma.applianceAssignment.deleteMany({ where: { rentalLine: { agreementId: { in: all } } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: renewals.map((r) => r.id) } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("auto-renew", () => {
    it("does nothing before the customer's reminder window opens", async () => {
      const a = await agreement();
      await runAutoRenewals(windowClosed);
      expect(await renewalsOf(a.id)).toHaveLength(0);
    });

    it("queues a month-to-month renewal once the window opens, moves Stripe's end date, and never doubles it", async () => {
      const a = await agreement();
      const first = await runAutoRenewals(windowOpen);
      expect(first.problems).toEqual([]);
      const renewals = await renewalsOf(a.id);
      expect(renewals).toHaveLength(1);
      const renewal = renewals[0]!;
      expect(renewal.status).toBe("SCHEDULED");
      expect(renewal.createdByAutoRenew).toBe(true);
      expect(renewal.termMonths).toBeNull();
      expect(renewal.startDate?.toISOString()).toBe(renewalStart.toISOString());
      expect(renewal.depositCents).toBe(0);
      expect(renewal.lines.map((l) => `${l.label}:${l.monthlyPriceCents}`).sort()).toEqual(["Dryer:3000", "Washer:3000"]);
      // Month-to-month has no end date: Stripe's cancel_at is cleared.
      expect(stripeMock.update).toHaveBeenCalledWith(a.stripeSubscriptionId, { cancel_at: "" }, expect.anything());
      expect(
        await prisma.auditLog.count({ where: { entityId: renewal.id, action: "agreement.auto_renewal_scheduled" } }),
      ).toBe(1);

      await runAutoRenewals(windowOpen);
      expect(await renewalsOf(a.id)).toHaveLength(1);
    });

    it("skips agreements that did not agree, asked to end early, or whose term already ran out", async () => {
      const off = await agreement({ renewalPreference: "NONE" });
      const ending = await agreement({ terminationRequestedAt: windowClosed, terminationEffectiveOn: effectiveOn });
      const expired = await agreement({ endDate: new Date("2027-10-01T06:59:59Z") });
      const monthToMonth = await agreement({ termMonths: null, endDate: null });
      await runAutoRenewals(afterTerm);
      for (const a of [off, ending, expired, monthToMonth]) expect(await renewalsOf(a.id)).toHaveLength(0);
    });

    it("turning auto-renew off cancels the queued renewal and gives Stripe the old end date back, but never touches a renewal signed by hand", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      const signed = await prisma.rentalAgreement.create({
        data: {
          customerId,
          serviceAddressId: addressId,
          status: "SCHEDULED",
          termMonths: 12,
          renewedFromAgreementId: a.id,
          startDate: renewalStart,
          endDate: new Date("2028-11-07T06:59:59Z"),
        },
      });
      // Only one live renewal is allowed per agreement in practice; cancel the auto one first to make room for the manual check.
      await setAutoRenew({ userId, kind: "customer" }, a.id, { enabled: false, termsVersion: "ar-test" });
      expect((await get(auto.id)).status).toBe("CANCELLED");
      expect((await get(signed.id)).status).toBe("SCHEDULED");
      expect(stripeMock.update).toHaveBeenLastCalledWith(
        a.stripeSubscriptionId,
        { cancel_at: Math.floor(termEnd.getTime() / 1000) },
        expect.anything(),
      );
      await prisma.rentalAgreement.update({ where: { id: signed.id }, data: { status: "CANCELLED" } });
    });

    it("an automatic renewal never starts once auto-renew was turned off, and the nightly pass cancels it", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      await prisma.rentalAgreement.update({ where: { id: a.id }, data: { renewalPreference: "NONE" } });
      const result = await startRenewalIfDue(auto.id, afterTerm);
      expect(result.started).toBe(false);
      if (!result.started) expect(result.reason).toBe("AUTO_RENEW_WITHDRAWN");
      expect((await get(a.id)).status).toBe("ACTIVE");
      const night = await runAutoRenewals(afterTerm);
      expect(night.cancelled).toBeGreaterThanOrEqual(1);
      expect((await get(auto.id)).status).toBe("CANCELLED");
    });

    it("an automatic renewal takes over on its start date like any signed renewal", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      const result = await startRenewalIfDue(auto.id, afterTerm);
      expect(result.started).toBe(true);
      expect((await get(a.id)).status).toBe("ENDED");
      const now = await get(auto.id);
      expect(now.status).toBe("ACTIVE");
      expect(now.stripeSubscriptionId).toBe(a.stripeSubscriptionId);
    });
  });

  describe("agreed early endings", () => {
    const ending = (extra: Parameters<typeof agreement>[0] = {}) =>
      agreement({
        renewalPreference: "NONE",
        terminationRequestedAt: new Date("2027-02-01T12:00:00Z"),
        terminationEffectiveOn: effectiveOn,
        terminationFeeCents: 5000,
        ...extra,
      });

    it("tells Stripe to stop billing just before the anniversary the rental ends on", async () => {
      const a = await ending();
      expect(await syncTerminationEnd(a.id)).toBe("done");
      expect(stripeMock.update).toHaveBeenCalledWith(
        a.stripeSubscriptionId,
        { cancel_at: Math.floor((effectiveOn.getTime() - 1000) / 1000) },
        expect.anything(),
      );
    });

    it("changes nothing before the ending date", async () => {
      const a = await ending();
      const result = await runDueTerminations(beforeEnding);
      expect(result.ended).toBe(0);
      expect((await get(a.id)).status).toBe("ACTIVE");
      expect(await prisma.invoice.count({ where: { agreementId: a.id } })).toBe(0);
    });

    it("on the ending date ends the rental, invoices the fee once as an open invoice, and charges nothing", async () => {
      const a = await ending();
      const first = await runDueTerminations(onEnding);
      expect(first.needsReview.filter((n) => n.agreementId === a.id)).toEqual([]);
      const after = await get(a.id);
      expect(after.status).toBe("ENDED");
      expect(after.endDate?.toISOString()).toBe(new Date(effectiveOn.getTime() - 1000).toISOString());
      const invoices = await prisma.invoice.findMany({ where: { agreementId: a.id }, include: { lineItems: true } });
      expect(invoices).toHaveLength(1);
      expect(invoices[0]!.status).toBe("OPEN");
      expect(invoices[0]!.amountDueCents).toBe(5000);
      expect(invoices[0]!.amountPaidCents).toBe(0);
      expect(invoices[0]!.taxCents).toBe(0);
      expect(invoices[0]!.lineItems.map((l) => [l.kind, l.amountCents])).toEqual([["EARLY_TERMINATION_FEE", 5000]]);

      await runDueTerminations(onEnding);
      expect(await prisma.invoice.count({ where: { agreementId: a.id } })).toBe(1);
    });

    it("a waived (zero) fee still ends the rental but creates no invoice", async () => {
      const a = await ending({ terminationFeeCents: 0 });
      await runDueTerminations(onEnding);
      expect((await get(a.id)).status).toBe("ENDED");
      expect(await prisma.invoice.count({ where: { agreementId: a.id } })).toBe(0);
    });

    it("a rental paid in advance is left for the owner to settle", async () => {
      const a = await ending({ paidInFullInAdvance: true });
      const result = await runDueTerminations(onEnding);
      expect((await get(a.id)).status).toBe("ACTIVE");
      const note = result.needsReview.find((n) => n.agreementId === a.id);
      expect(note?.message).toMatch(/paid in advance/i);
      expect(await prisma.invoice.count({ where: { agreementId: a.id } })).toBe(0);
    });

    it("asking to end early cancels the queued automatic renewal", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id)).find((r) => r.status === "SCHEDULED")!;
      await prisma.rentalAgreement.update({
        where: { id: a.id },
        data: { terminationRequestedAt: windowOpen, terminationEffectiveOn: effectiveOn },
      });
      const { cancelWithdrawnAutoRenewals } = await import("@/domains/agreements/auto-renew");
      await cancelWithdrawnAutoRenewals(null, a.id);
      expect((await get(auto.id)).status).toBe("CANCELLED");
    });
  });
});
