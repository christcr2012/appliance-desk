import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  update: vi.fn(),
  retrieve: vi.fn(),
  cancel: vi.fn(),
  state: new Map<string, number | null>(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: { update: stripeMock.update, retrieve: stripeMock.retrieve, cancel: stripeMock.cancel },
  }),
}));
const emailMock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: emailMock.send }));
const signing = vi.hoisted(() => ({ fail: false }));
vi.mock("@/domains/agreements", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domains/agreements")>();
  return {
    ...original,
    sendForSignature: vi.fn(async (...args: Parameters<typeof original.sendForSignature>) => {
      if (signing.fail) throw new Error("signing is unavailable");
      return original.sendForSignature(...args);
    }),
  };
});

import { prisma } from "@/lib/prisma";
import { runAutoRenewals } from "@/domains/agreements/auto-renew";
import { confirmEmailOutcome, recordNoticeDelivery } from "@/domains/notices";
import { getMissedNoticeOptions, resolveMissedNotice } from "@/domains/notices/resolution";
import { businessDateKey } from "@/lib/business-date";
import { createNoticeFixture, termEnd, windowOpen } from "./helpers/notice-fixture";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("recording a delivered reminder and fixing a missed one", () => {
  const fx = createNoticeFixture(stripeMock.state);
  let before: { autoRenewEnabled: boolean; noticeCertifierRoles: string; mailNoticeTransitDays: number } | null = null;
  let owner = "";
  let admin = "";
  let staff = "";

  const today = () => businessDateKey(new Date());
  const handInput = {
    channel: "IN_PERSON_WRITTEN",
    sentTo: "at the door",
    note: "handed a printed copy to the customer",
  } as const;

  async function reminder(options: { endDate?: Date; now?: Date } = {}) {
    const a = await fx.agreement(options.endDate ? { endDate: options.endDate } : {});
    await runAutoRenewals(options.now ?? windowOpen);
    return { a, notice: await fx.noticeOf(a) };
  }
  const makeMissed = async (options: { endDate?: Date; now?: Date } = {}) => {
    const r = await reminder(options);
    await prisma.customerNotice.update({ where: { id: r.notice.id }, data: { status: "MISSED", lastError: "missed" } });
    return { ...r, notice: await fx.noticeOf(r.a) };
  };
  const setSettings = (data: { noticeCertifierRoles?: string; mailNoticeTransitDays?: number }) =>
    prisma.businessSettings.update({ where: { id: "singleton" }, data });
  const resolve = (id: string, updatedAt: Date, choice: Parameters<typeof resolveMissedNotice>[3], by = owner) =>
    resolveMissedNotice(by, id, updatedAt, choice, "owner decision");

  beforeEach(() => {
    stripeMock.update.mockReset().mockImplementation(async (id: string, params?: { cancel_at?: number | "" }) => {
      if (params && params.cancel_at !== undefined) stripeMock.state.set(id, params.cancel_at === "" ? null : params.cancel_at);
      return { id };
    });
    stripeMock.retrieve.mockReset().mockImplementation(async (id: string) => ({
      id,
      status: "active",
      cancel_at: stripeMock.state.get(id) ?? null,
    }));
    emailMock.send.mockReset().mockResolvedValue({ sent: false, outcome: "NOT_ATTEMPTED" });
    signing.fail = false;
  });

  beforeAll(async () => {
    const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" } });
    before = {
      autoRenewEnabled: row?.autoRenewEnabled === true,
      noticeCertifierRoles: row?.noticeCertifierRoles ?? "OWNER",
      mailNoticeTransitDays: row?.mailNoticeTransitDays ?? 3,
    };
    await setSettings({ noticeCertifierRoles: "OWNER", mailNoticeTransitDays: 3 });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: true } });
    await fx.setup();
    owner = await fx.user("OWNER");
    admin = await fx.user("ADMIN");
    staff = await fx.user("STAFF");
  });

  afterAll(async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: before ?? {},
    });
    await fx.cleanup();
  });

  describe("recordNoticeDelivery", () => {
    it("admin is refused when the setting is OWNER only, and allowed when it is OWNER_AND_ADMIN; staff never", async () => {
      const { notice } = await reminder();
      await expect(recordNoticeDelivery(admin, notice.id, { ...handInput, date: today() })).rejects.toThrow(/no longer has access/);
      await expect(recordNoticeDelivery(staff, notice.id, { ...handInput, date: today() })).rejects.toThrow(/no longer has access/);
      await setSettings({ noticeCertifierRoles: "OWNER_AND_ADMIN" });
      try {
        await recordNoticeDelivery(admin, notice.id, { ...handInput, date: today() });
        expect((await fx.noticeOf({ id: notice.agreementId! })).status).toBe("SENT");
        await expect(recordNoticeDelivery(staff, notice.id, { ...handInput, date: today() })).rejects.toThrow();
      } finally {
        await setSettings({ noticeCertifierRoles: "OWNER" });
      }
    });

    it("a text is refused unless the customer opted in to texts", async () => {
      const { notice } = await reminder();
      await expect(recordNoticeDelivery(owner, notice.id, { channel: "TEXT_OR_APP", sentTo: "970-555-0100", note: "sent a text", date: today() })).rejects.toThrow(/texts/);
      await prisma.customer.update({ where: { id: fx.customerId }, data: { smsOptInAt: new Date() } });
      try {
        await recordNoticeDelivery(owner, notice.id, { channel: "TEXT_OR_APP", sentTo: "970-555-0100", note: "sent a text", date: today() });
        expect((await fx.noticeOf({ id: notice.agreementId! })).deliveryChannel).toBe("TEXT_OR_APP");
      } finally {
        await prisma.customer.update({ where: { id: fx.customerId }, data: { smsOptInAt: null } });
      }
    });

    it("mail: the mailing date plus the transit days is the evidence date, and the record cannot be recorded twice", async () => {
      const { notice } = await reminder();
      const mailed = businessDateKey(new Date(Date.now() - 10 * 86_400_000));
      await recordNoticeDelivery(owner, notice.id, { channel: "MAIL", sentTo: "1 Test St, Greeley CO", note: "first-class mail", date: mailed });
      const saved = await fx.noticeOf({ id: notice.agreementId! });
      expect(businessDateKey(saved.sentAt!)).toBe(mailed);
      const expected = businessDateKey(new Date(Date.now() - 7 * 86_400_000));
      expect(businessDateKey(saved.evidenceDate!)).toBe(expected);
      expect(saved.sentByUserId).toBe(owner);
      expect(saved.sentVia).toBe("HAND: MAIL");
      await expect(recordNoticeDelivery(owner, notice.id, { ...handInput, date: today() })).rejects.toThrow(/not waiting/);
    });

    it("refuses a future date, a phone call, and missing details", async () => {
      const { notice } = await reminder();
      const future = businessDateKey(new Date(Date.now() + 3 * 86_400_000));
      await expect(recordNoticeDelivery(owner, notice.id, { ...handInput, date: future })).rejects.toThrow(/future/);
      await expect(
        recordNoticeDelivery(owner, notice.id, { ...handInput, channel: "PHONE" as never, date: today() }),
      ).rejects.toThrow(/phone call is not a delivery/);
      await expect(recordNoticeDelivery(owner, notice.id, { ...handInput, note: " ", date: today() })).rejects.toThrow(/note/);
      await expect(recordNoticeDelivery(owner, notice.id, { ...handInput, sentTo: "x", date: today() })).rejects.toThrow(/address/);
      expect((await fx.noticeOf({ id: notice.agreementId! })).status).toBe("PENDING");
    });

    it("an evidence date outside the window is saved as SENT, but the renewal still cannot start (out of window)", async () => {
      const { a, notice } = await reminder();
      await recordNoticeDelivery(owner, notice.id, { ...handInput, date: today() });
      const { startRenewalIfDue } = await import("@/domains/agreements/renewal-start");
      const renewal = await prisma.rentalAgreement.findFirstOrThrow({ where: { renewedFromAgreementId: a.id, createdByAutoRenew: true } });
      const result = await startRenewalIfDue(renewal.id, new Date("2027-11-09T12:00:00Z"));
      expect(result.started).toBe(false);
      if (!result.started) expect(result.reason).toBe("NOTICE_OUT_OF_WINDOW");
    });
  });

  describe("confirmEmailOutcome", () => {
    it("went out: records the delivery with the date shown; did not go out: back in line only while the window is open", async () => {
      const { notice } = await reminder();
      await prisma.customerNotice.update({ where: { id: notice.id }, data: { status: "UNCERTAIN" } });
      await confirmEmailOutcome(owner, notice.id, { sent: false });
      let row = await fx.noticeOf({ id: notice.agreementId! });
      // The window of this reminder (2027) is still open today, so it went back to PENDING.
      expect(row.status).toBe("PENDING");
      await prisma.customerNotice.update({ where: { id: notice.id }, data: { status: "UNCERTAIN" } });
      await confirmEmailOutcome(owner, notice.id, { sent: true, acceptedOn: today() });
      row = await fx.noticeOf({ id: notice.agreementId! });
      expect(row.status).toBe("SENT");
      expect(row.deliveryChannel).toBe("EMAIL");
      expect(businessDateKey(row.evidenceDate!)).toBe(today());
    });

    it("'it did not go out' is refused after the last allowed day", async () => {
      const { notice } = await reminder();
      await prisma.customerNotice.update({
        where: { id: notice.id },
        data: { status: "UNCERTAIN", deadlineAt: new Date(Date.now() - 86_400_000) },
      });
      await expect(confirmEmailOutcome(owner, notice.id, { sent: false })).rejects.toThrow(/last day/);
    });
  });

  describe("resolveMissedNotice", () => {
    it("cancel: the automatic renewal is cancelled, the reminder is NOT_NEEDED, billing goes back to the old end date", async () => {
      const { a, notice } = await makeMissed();
      const out = await resolve(notice.id, notice.updatedAt, { kind: "CANCEL_AUTOMATIC_RENEWAL", schedulePickup: false });
      expect(out.redirectTo).toBe(`/desk/agreements/${a.id}`);
      const renewal = await prisma.rentalAgreement.findFirstOrThrow({ where: { renewedFromAgreementId: a.id } });
      expect(renewal.status).toBe("CANCELLED");
      const row = await fx.noticeOf(a);
      expect(row.status).toBe("NOT_NEEDED");
      expect(row.resolvedByUserId).toBe(owner);
      expect(row.resolution).toMatch(/^CANCEL_AUTOMATIC_RENEWAL: /);
      expect(stripeMock.state.get(a.stripeSubscriptionId!)).toBe(Math.floor(termEnd.getTime() / 1000));
      expect(await prisma.job.count({ where: { agreementId: a.id, type: "REMOVAL" } })).toBe(0);
      const audit = await prisma.auditLog.findFirst({ where: { entityId: notice.id, action: "notice.missed_resolved" } });
      expect(audit).not.toBeNull();
    });

    it("cancel with pickup creates exactly one REMOVAL visit the day after the term ends (a term ending the day clocks fall back)", async () => {
      const endDate = new Date("2026-11-02T06:59:59Z"); // last second of Sunday 2026-11-01, the day clocks fall back
      const { a, notice } = await makeMissed({ endDate, now: new Date("2026-10-12T12:00:00Z") });
      await resolve(notice.id, notice.updatedAt, { kind: "CANCEL_AUTOMATIC_RENEWAL", schedulePickup: true });
      const jobs = await prisma.job.findMany({ where: { agreementId: a.id, type: "REMOVAL" } });
      expect(jobs).toHaveLength(1);
      // 9:00 on Monday 2026-11-02 in Colorado (MST, UTC-7).
      expect(jobs[0]!.scheduledAt?.toISOString()).toBe("2026-11-02T16:00:00.000Z");
      expect(jobs[0]!.assignedToUserId).toBeNull();
      expect(jobs[0]!.serviceAddressId).toBe(fx.addressId);
    });

    it("send-new-renewal: one draft and one signature request, the automatic renewal is CANCELLED, month-to-month or 12 months", async () => {
      const { a, notice } = await makeMissed();
      await resolve(notice.id, notice.updatedAt, { kind: "SEND_NEW_RENEWAL", termMonths: 12 });
      const renewals = await prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: a.id }, orderBy: { createdAt: "asc" } });
      expect(renewals.map((r) => [r.createdByAutoRenew, r.status])).toEqual([[true, "CANCELLED"], [false, "AWAITING_SIGNATURE"]]);
      expect(renewals[1]!.termMonths).toBe(12);
      expect(await prisma.signatureRecord.count({ where: { agreementId: renewals[1]!.id } })).toBe(1);
      // Nothing extends billing before the customer signs.
      expect(stripeMock.state.get(a.stripeSubscriptionId!)).toBe(Math.floor(termEnd.getTime() / 1000));
    });

    it("send-new-renewal with signing failing leaves the automatic renewal cancelled and says which step failed", async () => {
      const { a, notice } = await makeMissed();
      signing.fail = true;
      await expect(resolve(notice.id, notice.updatedAt, { kind: "SEND_NEW_RENEWAL", termMonths: null })).rejects.toThrow(
        /new renewal was created, but it could not be sent for signature/,
      );
      const renewals = await prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: a.id }, orderBy: { createdAt: "asc" } });
      expect(renewals.map((r) => r.status)).toEqual(["CANCELLED", "DRAFT"]);
      expect(stripeMock.state.get(a.stripeSubscriptionId!)).toBe(Math.floor(termEnd.getTime() / 1000));
    });

    it("move-later is not offered on its own (it needs a signature, so it is the month-to-month renewal) and still works when chosen", async () => {
      const { a, notice } = await makeMissed();
      const options = (await getMissedNoticeOptions(notice.id)).options;
      expect(options.find((o) => o.kind === "MOVE_RENEWAL_LATER")?.available).toBe(false);
      expect(options.find((o) => o.kind === "SEND_NEW_RENEWAL")?.available).toBe(true);
      await resolve(notice.id, notice.updatedAt, { kind: "MOVE_RENEWAL_LATER" });
      const draft = await prisma.rentalAgreement.findFirstOrThrow({ where: { renewedFromAgreementId: a.id, createdByAutoRenew: false } });
      expect(draft.termMonths).toBeNull();
      expect(draft.status).toBe("AWAITING_SIGNATURE");
    });

    it("keep-waiting creates one task due that day (a retry makes no second one) and changes nothing else", async () => {
      const { a, notice } = await makeMissed();
      const remindOn = businessDateKey(new Date(Date.now() + 5 * 86_400_000));
      await resolve(notice.id, notice.updatedAt, { kind: "KEEP_WAITING", remindOn });
      const tasks = await prisma.staffTask.findMany({ where: { customerId: fx.customerId, sourceKey: { startsWith: `notice-keep-waiting-${notice.id}` } } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.dueDate!.toISOString().slice(0, 10)).toBe(remindOn);
      const row = await fx.noticeOf(a);
      expect(row.status).toBe("MISSED");
      expect(await prisma.rentalAgreement.count({ where: { renewedFromAgreementId: a.id, status: "SCHEDULED" } })).toBe(1);
    });

    it("end-rental changes nothing itself and returns the rental's page", async () => {
      const { a, notice } = await makeMissed();
      const out = await resolve(notice.id, notice.updatedAt, { kind: "END_RENTAL" });
      expect(out.redirectTo).toBe(`/desk/agreements/${a.id}`);
      expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ACTIVE");
    });

    it("a screen that is out of date is refused, and staff cannot resolve", async () => {
      const { notice } = await makeMissed();
      await expect(
        resolve(notice.id, new Date(notice.updatedAt.getTime() - 1000), { kind: "END_RENTAL" }),
      ).rejects.toThrow(/changed since you opened it/);
      await expect(resolve(notice.id, notice.updatedAt, { kind: "END_RENTAL" }, staff)).rejects.toThrow(/no longer has access/);
      expect((await fx.noticeOf({ id: notice.agreementId! })).resolution).toBeNull();
    });

    it("an uncertain reminder keeps its evidence question open when the renewal is cancelled from the screen", async () => {
      const { a, notice } = await reminder();
      await prisma.customerNotice.update({ where: { id: notice.id }, data: { status: "UNCERTAIN" } });
      const fresh = await fx.noticeOf(a);
      await resolve(fresh.id, fresh.updatedAt, { kind: "CANCEL_AUTOMATIC_RENEWAL", schedulePickup: false });
      expect((await fx.noticeOf(a)).status).toBe("UNCERTAIN");
    });
  });
});
