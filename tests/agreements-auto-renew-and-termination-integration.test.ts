import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  update: vi.fn(),
  retrieve: vi.fn(),
  cancel: vi.fn(),
  // What the fake Stripe currently holds as each subscription's cancel_at (null = none).
  state: new Map<string, number | null>(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: { update: stripeMock.update, retrieve: stripeMock.retrieve, cancel: stripeMock.cancel },
  }),
}));

import { prisma } from "@/lib/prisma";
import { runAutoRenewals, extendBillingForDeliveredAutoRenewals } from "@/domains/agreements/auto-renew";
import { runDueTerminations } from "@/domains/agreements/termination-execution";
import { startRenewalIfDue } from "@/domains/agreements/renewal-start";
import { setAutoRenew } from "@/domains/agreements/term";
import { listWaitingNotices, markNoticeDeliveredByHand, sendPendingNotices } from "@/domains/notices";
import { renewalReminderKey } from "@/domains/notices/renewal-reminder";

const emailMock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: emailMock.send }));
import { applySubscriptionEnd, recomputeSubscriptionEndInTx } from "@/domains/billing/subscription-end";
import { cancelAtSecondsFor } from "@/domains/billing/subscription-term";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const termEnd = new Date("2027-11-08T06:59:59Z");
const renewalStart = new Date("2027-11-08T07:00:00Z");
const windowClosed = new Date("2027-09-01T12:00:00Z");
const windowOpen = new Date("2027-10-20T12:00:00Z");
// 27 days before the renewal starts: inside the 25 to 40 day reminder window.
const inReminderWindow = new Date("2027-10-12T18:00:00Z");
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
    // A fixed-term subscription is created in Stripe already carrying its end date.
    if (created.stripeSubscriptionId && created.termMonths && created.endDate) {
      stripeMock.state.set(created.stripeSubscriptionId, cancelAtSecondsFor(created));
    }
    return created;
  }

  const get = (id: string) => prisma.rentalAgreement.findUniqueOrThrow({ where: { id } });
  const noticeOf = (a: { id: string; endDate: Date | null }) =>
    prisma.customerNotice.findUnique({ where: { dedupeKey: renewalReminderKey(a.id, a.endDate!) } });
  const deliver = (a: { id: string; endDate: Date | null }) =>
    prisma.customerNotice.update({
      where: { dedupeKey: renewalReminderKey(a.id, a.endDate!) },
      data: { status: "SENT", sentAt: new Date("2027-10-10T15:00:00Z"), sentVia: "HAND: test" },
    });
  const renewalsOf = (id: string) =>
    prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: id }, include: { lines: true } });

  beforeEach(() => {
    stripeMock.state.clear();
    stripeMock.update.mockReset().mockImplementation(async (id: string, params?: { cancel_at?: number | "" }) => {
      if (params && params.cancel_at !== undefined) stripeMock.state.set(id, params.cancel_at === "" ? null : params.cancel_at);
      return { id };
    });
    stripeMock.retrieve.mockReset().mockImplementation(async (id: string) => ({
      id,
      status: "active",
      cancel_at: stripeMock.state.get(id) ?? null,
    }));
    stripeMock.cancel.mockReset().mockImplementation(async (id: string) => ({ id }));
    emailMock.send.mockReset().mockResolvedValue({ sent: false });
  });

  let switchBefore = false;
  beforeAll(async () => {
    // Automatic renewals are off by default; these tests exercise them, so the owner's master switch is on.
    switchBefore =
      (await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { autoRenewEnabled: true } }))
        ?.autoRenewEnabled === true;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: true } });
    await prisma.user.create({
      data: { id: userId, email: `${tag}-c@example.test`, name: "AR Customer", role: "CUSTOMER", emailVerified: true },
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `A${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" },
    });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: switchBefore } });
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
    await prisma.customerNotice.deleteMany({ where: { customerId } });
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
      // Billing's end date is NOT moved while the reminder has not been delivered...
      expect(stripeMock.update).not.toHaveBeenCalled();
      await extendBillingForDeliveredAutoRenewals(windowOpen);
      expect(stripeMock.update).not.toHaveBeenCalled();
      // ...and once it was delivered in the 25 to 40 day window, billing carries on: cancel_at is cleared.
      await deliver(a);
      await extendBillingForDeliveredAutoRenewals(windowOpen);
      expect(stripeMock.update).toHaveBeenCalledWith(a.stripeSubscriptionId, { cancel_at: "" }, expect.anything());
      expect(
        await prisma.auditLog.count({ where: { entityId: renewal.id, action: "agreement.auto_renewal_scheduled" } }),
      ).toBe(1);

      await runAutoRenewals(windowOpen);
      expect(await renewalsOf(a.id)).toHaveLength(1);
    });

    it("writes the renewal reminder with the renewal, using the wording the customer agreed to, and never duplicates it", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      await runAutoRenewals(windowOpen);
      const notice = (await noticeOf(a))!;
      expect(notice.status).toBe("PENDING");
      expect(notice.kind).toBe("RENEWAL_REMINDER");
      expect(notice.body).toContain("Renews month to month.");
      expect(notice.body).toContain("$60 a month");
      expect(notice.body).toContain("Washer, Dryer");
      expect(await prisma.customerNotice.count({ where: { agreementId: a.id } })).toBe(1);
    });

    it("an automatic renewal waits for its reminder: it will not start until the reminder is delivered", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      const held = await startRenewalIfDue(auto.id, afterTerm);
      expect(held.started).toBe(false);
      if (!held.started) expect(held.reason).toBe("NOTICE_NOT_SENT");
      expect((await get(a.id)).status).toBe("ACTIVE");
      await deliver(a);
      expect((await startRenewalIfDue(auto.id, afterTerm)).started).toBe(true);
    });

    it("email being off leaves the reminder waiting; email on marks it sent; the owner can mark it delivered by hand", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const off = await sendPendingNotices(inReminderWindow);
      expect(off.stillWaiting).toBeGreaterThanOrEqual(1);
      expect((await noticeOf(a))!.status).toBe("PENDING");
      expect((await noticeOf(a))!.attempts).toBeGreaterThanOrEqual(1);

      emailMock.send.mockResolvedValue({ sent: true });
      await sendPendingNotices(inReminderWindow);
      const sent = (await noticeOf(a))!;
      expect(sent.status).toBe("SENT");
      expect(sent.sentVia).toBe("EMAIL");

      const b = await agreement();
      await runAutoRenewals(windowOpen);
      const ownerId = `ar-owner-${tag}`;
      await prisma.user.create({ data: { id: ownerId, email: `${tag}-o@example.test`, name: "AR Owner", role: "OWNER", emailVerified: true } });
      try {
        const pending = (await noticeOf(b))!;
        await expect(markNoticeDeliveredByHand(userId, pending.id, "phoned")).rejects.toThrow();
        await expect(
          markNoticeDeliveredByHand(ownerId, pending.id, "phoned", new Date(Date.now() + 3 * 86_400_000)),
        ).rejects.toThrow(/future/);
        await markNoticeDeliveredByHand(ownerId, pending.id, "phoned");
        const done = (await noticeOf(b))!;
        expect(done.status).toBe("SENT");
        expect(done.sentVia).toBe("HAND: phoned");
        expect(done.sentByUserId).toBe(ownerId);
        await expect(markNoticeDeliveredByHand(ownerId, pending.id, "phoned")).rejects.toThrow(/not waiting/);
      } finally {
        await prisma.customerNotice.updateMany({ where: { sentByUserId: ownerId }, data: { sentByUserId: null } });
        await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
        await prisma.user.delete({ where: { id: ownerId } });
      }
    });

    it("a reminder delivered outside the 25 to 40 days before the renewal does not let it start by itself", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      for (const when of ["2027-11-05T15:00:00Z", "2027-09-01T15:00:00Z"]) {
        await prisma.customerNotice.update({
          where: { dedupeKey: renewalReminderKey(a.id, a.endDate!) },
          data: { status: "SENT", sentAt: new Date(when), sentVia: "EMAIL" },
        });
        const result = await startRenewalIfDue(auto.id, afterTerm);
        expect(result.started).toBe(false);
        if (!result.started) expect(result.reason).toBe("NOTICE_OUT_OF_WINDOW");
      }
      await deliver(a);
      expect((await startRenewalIfDue(auto.id, afterTerm)).started).toBe(true);
    });

    it("the nightly job and the owner cannot both deliver a notice: it is claimed first, so it is emailed at most once", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      emailMock.send.mockReset().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { sent: true };
      });
      await Promise.all([sendPendingNotices(inReminderWindow), sendPendingNotices(inReminderWindow)]);
      const mine = (await noticeOf(a))!;
      expect(mine.status).toBe("SENT");
      expect(mine.sentVia).toBe("EMAIL");
      expect(mine.attempts).toBe(1);
    });

    it("a notice whose send failed goes back to waiting (never stuck as 'sending')", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      emailMock.send.mockReset().mockRejectedValue(new Error("provider down"));
      await sendPendingNotices(inReminderWindow);
      expect((await noticeOf(a))!.status).toBe("PENDING");
    });

    it("turning auto-renew off withdraws the waiting reminder", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      await setAutoRenew({ userId, kind: "customer" }, a.id, { enabled: false, termsVersion: "ar-test" });
      expect((await noticeOf(a))!.status).toBe("NOT_NEEDED");
    });

    it("turning auto-renew off while a reminder is being sent does not erase it, and a withdrawn reminder comes back when auto-renew is turned on again", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const key = renewalReminderKey(a.id, a.endDate!);
      await prisma.customerNotice.update({ where: { dedupeKey: key }, data: { status: "SENDING" } });
      await setAutoRenew({ userId, kind: "customer" }, a.id, { enabled: false, termsVersion: "ar-test" });
      expect((await noticeOf(a))!.status).toBe("SENDING");

      const b = await agreement();
      await runAutoRenewals(windowOpen);
      await setAutoRenew({ userId, kind: "customer" }, b.id, { enabled: false, termsVersion: "ar-test" });
      expect((await noticeOf(b))!.status).toBe("NOT_NEEDED");
      await setAutoRenew({ userId, kind: "customer" }, b.id, { enabled: true, termsVersion: "ar-test" });
      await runAutoRenewals(windowOpen);
      expect((await noticeOf(b))!.status).toBe("PENDING");
      expect(await prisma.customerNotice.count({ where: { agreementId: b.id } })).toBe(1);
    });

    it("the owner can record the day a reminder was actually delivered, and that day is what counts", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const ownerId = `ar-owner2-${tag}`;
      await prisma.user.create({ data: { id: ownerId, email: `${tag}-o2@example.test`, name: "AR Owner 2", role: "OWNER", emailVerified: true } });
      try {
        const pending = (await noticeOf(a))!;
        const earlier = new Date(Date.now() - 2 * 86_400_000);
        await markNoticeDeliveredByHand(ownerId, pending.id, "mailed", earlier);
        expect((await noticeOf(a))!.sentAt?.toISOString()).toBe(earlier.toISOString());
      } finally {
        await prisma.customerNotice.updateMany({ where: { sentByUserId: ownerId }, data: { sentByUserId: null } });
        await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
        await prisma.user.delete({ where: { id: ownerId } });
      }
    });

    it("never emails a reminder that can no longer be delivered 25 to 40 days ahead; it stays on the owner's list", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      emailMock.send.mockReset().mockResolvedValue({ sent: true });
      const tooLate = new Date("2027-11-02T18:00:00Z"); // 6 days before the renewal
      const result = await sendPendingNotices(tooLate);
      expect(result.sent).toBe(0);
      expect(emailMock.send).not.toHaveBeenCalled();
      const waiting = (await noticeOf(a))!;
      expect(waiting.status).toBe("PENDING");
      expect(waiting.attempts).toBe(0);
      expect((await listWaitingNotices()).some((n) => n.id === waiting.id)).toBe(true);
    });

    it("an interrupted send is never retried by itself (the provider may have sent it); the owner sees it and settles it by hand", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const key = renewalReminderKey(a.id, a.endDate!);
      await prisma.customerNotice.update({
        where: { dedupeKey: key },
        data: { status: "SENDING", updatedAt: new Date(Date.now() - 3 * 60 * 60_000) },
      });
      emailMock.send.mockReset().mockResolvedValue({ sent: true });
      await sendPendingNotices(inReminderWindow);
      const stuck = (await noticeOf(a))!;
      expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${stuck.id}` }));
      expect(stuck.status).toBe("SENDING");
      const listed = (await listWaitingNotices()).find((n) => n.id === stuck.id);
      expect(listed?.status).toBe("SENDING");

      const ownerId = `ar-owner3-${tag}`;
      await prisma.user.create({ data: { id: ownerId, email: `${tag}-o3@example.test`, name: "AR Owner 3", role: "OWNER", emailVerified: true } });
      try {
        const when = new Date(Date.now() - 86_400_000);
        await markNoticeDeliveredByHand(ownerId, stuck.id, "checked provider log", when);
        const done = (await noticeOf(a))!;
        expect(done.status).toBe("SENT");
        expect(done.sentAt?.toISOString()).toBe(when.toISOString());
      } finally {
        await prisma.customerNotice.updateMany({ where: { sentByUserId: ownerId }, data: { sentByUserId: null } });
        await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
        await prisma.user.delete({ where: { id: ownerId } });
      }
    });

    it("an opt-out that is saved but whose renewal is not cancelled yet can never let billing be extended", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      await deliver(a);
      // The customer's choice is saved first; the renewal's cancellation follows a moment later.
      await prisma.rentalAgreement.update({ where: { id: a.id }, data: { renewalPreference: "NONE" } });
      stripeMock.update.mockClear();
      await extendBillingForDeliveredAutoRenewals(windowOpen);
      expect(stripeMock.update).not.toHaveBeenCalled();
    });

    it("a notice that keeps failing goes to the back of the line, so it cannot starve newer notices", async () => {
      const a = await agreement();
      const b = await agreement();
      await runAutoRenewals(windowOpen);
      const first = (await noticeOf(a))!;
      const second = (await noticeOf(b))!;
      emailMock.send.mockReset().mockImplementation(async (input: { idempotencyKey?: string }) => {
        if (input.idempotencyKey === `customer-notice-${first.id}`) throw new Error("rejected address");
        return { sent: true };
      });
      await sendPendingNotices(inReminderWindow);
      await sendPendingNotices(inReminderWindow);
      expect((await noticeOf(b))!.status).toBe("SENT");
      expect((await noticeOf(a))!.status).toBe("PENDING");
      expect(second.id).not.toBe(first.id);
    });

    it("with the owner's automatic-renewal switch OFF nothing is queued, started or extended, but a customer can still opt out", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      await deliver(a);
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: false } });
      try {
        // Starting is refused first (before the nightly pass below withdraws the queued renewal).
        const started = await startRenewalIfDue(auto.id, afterTerm);
        expect(started.started).toBe(false);
        if (!started.started) expect(started.reason).toBe("AUTO_RENEW_OFF");

        stripeMock.update.mockClear();
        expect(await extendBillingForDeliveredAutoRenewals(windowOpen)).toBe(0);
        expect(stripeMock.update).not.toHaveBeenCalled();

        // The nightly pass queues nothing new, and withdraws what was queued.
        const b = await agreement();
        const queued = await runAutoRenewals(windowOpen);
        expect(queued.created).toBe(0);
        expect(await renewalsOf(b.id)).toHaveLength(0);
        expect((await get(auto.id)).status).toBe("CANCELLED");

        // Opting out still works while the switch is off.
        await setAutoRenew({ userId, kind: "customer" }, a.id, { enabled: false, termsVersion: "ar-test" });
        expect((await get(a.id)).renewalPreference).toBe("NONE");
      } finally {
        await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: true } });
      }
    });

    it("turning the switch OFF after billing was extended restores the old end date and withdraws the reminder; a waiting reminder is never emailed while it is off", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      await deliver(a);
      stripeMock.update.mockClear();
      await extendBillingForDeliveredAutoRenewals(windowOpen);
      expect(stripeMock.update).toHaveBeenCalledWith(a.stripeSubscriptionId, { cancel_at: "" }, expect.anything());

      const b = await agreement();
      await runAutoRenewals(windowOpen);
      const waiting = (await noticeOf(b))!;

      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: false } });
      try {
        emailMock.send.mockReset().mockResolvedValue({ sent: true, outcome: "SENT" });
        await sendPendingNotices(inReminderWindow);
        expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${waiting.id}` }));
        expect((await noticeOf(b))!.status).toBe("PENDING");

        stripeMock.update.mockClear();
        const { cancelWithdrawnAutoRenewals } = await import("@/domains/agreements/auto-renew");
        await cancelWithdrawnAutoRenewals(null);
        expect((await get(auto.id)).status).toBe("CANCELLED");
        expect(stripeMock.update).toHaveBeenCalledWith(
          a.stripeSubscriptionId,
          { cancel_at: Math.floor(termEnd.getTime() / 1000) },
          expect.anything(),
        );
        expect((await noticeOf(b))!.status).toBe("NOT_NEEDED");
      } finally {
        await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: true } });
      }
    });

    it("an email whose outcome is unknown, or whose SENT save failed, is never sent a second time; it waits for the owner", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const first = (await noticeOf(a))!;
      emailMock.send.mockReset().mockImplementation(async (input: { idempotencyKey?: string }) =>
        input.idempotencyKey === `customer-notice-${first.id}` ? { sent: false, outcome: "UNKNOWN" } : { sent: false },
      );
      await sendPendingNotices(inReminderWindow);
      expect((await noticeOf(a))!.status).toBe("SENDING");

      const b = await agreement();
      await runAutoRenewals(windowOpen);
      const second = (await noticeOf(b))!;
      emailMock.send.mockReset().mockImplementation(async (input: { idempotencyKey?: string }) =>
        input.idempotencyKey === `customer-notice-${second.id}` ? { sent: true, outcome: "SENT" } : { sent: false },
      );
      const real = prisma.customerNotice.updateMany.bind(prisma.customerNotice);
      const spy = vi.spyOn(prisma.customerNotice, "updateMany").mockImplementation(((args: { data?: { status?: string } }) =>
        args?.data?.status === "SENT" ? Promise.reject(new Error("db down")) : real(args as never)) as never);
      try {
        await sendPendingNotices(inReminderWindow);
      } finally {
        spy.mockRestore();
      }
      expect((await noticeOf(b))!.status).toBe("SENDING");

      emailMock.send.mockClear();
      await sendPendingNotices(inReminderWindow);
      expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${first.id}` }));
      expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${second.id}` }));
    });

    it("the Notices list tells a missed deadline from one that is simply too early", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const id = (await noticeOf(a))!.id;
      const state = async (when: Date) => (await listWaitingNotices(when)).find((n) => n.id === id)?.deadline;
      expect(await state(new Date("2027-11-02T18:00:00Z"))).toBe("MISSED");
      expect(await state(inReminderWindow)).toBe("OK");
      expect(await state(new Date("2027-09-20T18:00:00Z"))).toBe("TOO_EARLY");
    });

    it("two overlapping nightly runs queue exactly one renewal", async () => {
      const a = await agreement();
      await Promise.all([runAutoRenewals(windowOpen), runAutoRenewals(windowOpen)]);
      const renewals = await renewalsOf(a.id);
      expect(renewals).toHaveLength(1);
      expect(
        await prisma.auditLog.count({ where: { entityId: renewals[0]!.id, action: "agreement.auto_renewal_scheduled" } }),
      ).toBe(1);
      const subscriptionOps = () =>
        prisma.providerOperation.count({ where: { subjectType: "StripeSubscription", subjectId: a.stripeSubscriptionId! } });
      expect(await subscriptionOps()).toBe(0);
      await deliver(a);
      await Promise.all([extendBillingForDeliveredAutoRenewals(windowOpen), extendBillingForDeliveredAutoRenewals(windowOpen)]);
      // One worker holds the lease at a time, so the two runs make exactly one change at Stripe.
      expect(await subscriptionOps()).toBe(1);
    });

    it("never auto-renews a rental that was paid in advance (no monthly billing to carry on)", async () => {
      const a = await agreement({ paidInFullInAdvance: true, sub: false });
      await runAutoRenewals(windowOpen);
      expect(await renewalsOf(a.id)).toHaveLength(0);
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
      // With the automatic renewal gone, the answer comes from what is left: the hand-signed renewal
      // (rule 6 of the billing-end contract), so billing carries on to the end of that renewal, not the old term.
      expect(stripeMock.update).toHaveBeenLastCalledWith(
        a.stripeSubscriptionId,
        { cancel_at: cancelAtSecondsFor({ termMonths: 12, endDate: new Date("2028-11-07T06:59:59Z") }) },
        expect.anything(),
      );
      await prisma.rentalAgreement.update({ where: { id: signed.id }, data: { status: "CANCELLED" } });
    });

    it("an automatic renewal never starts once auto-renew was turned off, and the nightly pass cancels it", async () => {
      const a = await agreement();
      await runAutoRenewals(windowOpen);
      const auto = (await renewalsOf(a.id))[0]!;
      await prisma.rentalAgreement.update({ where: { id: a.id }, data: { renewalPreference: "NONE" } });
      stripeMock.update.mockClear();
      const result = await startRenewalIfDue(auto.id, afterTerm);
      // The withdrawn renewal must not touch the customer's subscription at all.
      expect(stripeMock.update).not.toHaveBeenCalled();
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
      await deliver(a);
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
      await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, a.stripeSubscriptionId!));
      expect(await applySubscriptionEnd(a.stripeSubscriptionId!)).toBe("APPLIED");
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

    it("two overlapping nightly runs invoice the fee once and end the rental once", async () => {
      const a = await ending();
      await Promise.all([runDueTerminations(onEnding), runDueTerminations(onEnding)]);
      expect((await get(a.id)).status).toBe("ENDED");
      expect(await prisma.invoice.count({ where: { agreementId: a.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "agreement.end" } })).toBe(1);
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
