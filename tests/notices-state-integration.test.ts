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
const emailMock = vi.hoisted(() => ({ send: vi.fn(), acceptedAt: vi.fn() }));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: emailMock.send }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), getEmailAcceptedAt: emailMock.acceptedAt }));

import { prisma } from "@/lib/prisma";
import { runAutoRenewals } from "@/domains/agreements/auto-renew";
import { cancelAgreement } from "@/domains/agreements";
import { sendPendingNotices } from "@/domains/notices";
import { createNoticeFixture, inReminderWindow, windowOpen } from "./helpers/notice-fixture";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const HOUR = 3_600_000;

describe.skipIf(!enabled)("renewal reminders: states, windows, retries and evidence", () => {
  const fx = createNoticeFixture(stripeMock.state);
  let switchBefore = false;

  async function reminder() {
    const a = await fx.agreement();
    await runAutoRenewals(windowOpen);
    return { a, notice: await fx.noticeOf(a) };
  }

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
    emailMock.send.mockReset().mockResolvedValue({ sent: true, outcome: "SENT" });
    emailMock.acceptedAt.mockReset().mockResolvedValue(null);
  });

  beforeAll(async () => {
    switchBefore =
      (await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { autoRenewEnabled: true } }))
        ?.autoRenewEnabled === true;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: true } });
    await fx.setup();
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: switchBefore } });
    await fx.cleanup();
  });

  it("new reminders carry the window: from 40 days before the renewal to the end of the day 25 days before", async () => {
    const { notice } = await reminder();
    expect(notice.earliestAt?.toISOString()).toBe("2027-09-29T06:00:00.000Z");
    expect(notice.deadlineAt?.toISOString()).toBe("2027-10-15T05:59:59.000Z");
  });

  for (const [name, now] of [
    ["notice-email-on-at-24-days-goes-missed-not-sent", new Date("2027-10-15T18:00:00Z")],
    ["notice-email-on-at-10-days-goes-missed-not-sent", new Date("2027-10-29T18:00:00Z")],
    ["notice-email-on-after-renewal-start-goes-missed", new Date("2027-11-09T18:00:00Z")],
  ] as const) {
    it(name, async () => {
      const { notice } = await reminder();
      await sendPendingNotices(now);
      expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${notice.id}` }));
      const after = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });
      expect(after.status).toBe("MISSED");
      // A missed notice is never picked up again.
      emailMock.send.mockClear();
      await sendPendingNotices(inReminderWindow);
      expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${notice.id}` }));
    });
  }

  it("a notice is not sent before its first allowed day", async () => {
    const { notice } = await reminder();
    await sendPendingNotices(new Date("2027-09-20T18:00:00Z"));
    expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${notice.id}` }));
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe("PENDING");
  });

  it("notice-evidence-date-is-provider-acceptance-time", async () => {
    const { notice } = await reminder();
    const accepted = new Date("2027-10-12T17:59:00Z");
    emailMock.send.mockResolvedValue({ sent: true, outcome: "SENT", providerMessageId: `msg_${notice.id}` });
    emailMock.acceptedAt.mockResolvedValue(accepted);
    await sendPendingNotices(inReminderWindow);
    const after = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });
    expect(after.status).toBe("SENT");
    expect(after.deliveryChannel).toBe("EMAIL");
    expect(after.providerMessageId).toBe(`msg_${notice.id}`);
    expect(after.acceptedAt?.toISOString()).toBe(accepted.toISOString());
    expect(after.evidenceDate?.toISOString()).toBe(accepted.toISOString());
    expect(after.sentToAddress).toBe(`${fx.tag}-c@example.test`);
    expect(after.claimToken).toBeNull();
  });

  it("notice-lost-response-retried-once-same-key", async () => {
    const { notice } = await reminder();
    emailMock.send.mockReset().mockImplementation(async (input: { idempotencyKey?: string }) =>
      input.idempotencyKey === `customer-notice-${notice.id}`
        ? emailMock.send.mock.calls.filter((c) => c[0].idempotencyKey === input.idempotencyKey).length === 1
          ? { sent: false, outcome: "UNKNOWN" }
          : { sent: true, outcome: "SENT" }
        : { sent: false, outcome: "NOT_ATTEMPTED" },
    );
    await sendPendingNotices(inReminderWindow);
    const calls = emailMock.send.mock.calls.map((c) => c[0]).filter((c) => c.idempotencyKey === `customer-notice-${notice.id}`);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe("SENT");
  });

  it("an unclear answer twice makes it UNCERTAIN, and a cancelled renewal does not erase that question (notice-cancelled-while-uncertain-stays-uncertain)", async () => {
    const { a, notice } = await reminder();
    emailMock.send.mockImplementation(async (input: { idempotencyKey?: string }) =>
      input.idempotencyKey === `customer-notice-${notice.id}` ? { sent: false, outcome: "UNKNOWN" } : { sent: false, outcome: "NOT_ATTEMPTED" },
    );
    await sendPendingNotices(inReminderWindow);
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe("UNCERTAIN");
    const renewal = await prisma.rentalAgreement.findFirstOrThrow({ where: { renewedFromAgreementId: a.id, createdByAutoRenew: true } });
    await cancelAgreement(null, renewal.id);
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe("UNCERTAIN");
    // Never sent again by itself.
    emailMock.send.mockClear();
    await sendPendingNotices(inReminderWindow);
    expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${notice.id}` }));
  });

  it("notice-accepted-then-db-failure-recovered-same-key-no-second-email, and notice-recipient-change-after-claim-uses-frozen-address", async () => {
    const { notice } = await reminder();
    const frozen = `${fx.tag}-c@example.test`;
    emailMock.send.mockImplementation(async (input: { idempotencyKey?: string }) =>
      input.idempotencyKey === `customer-notice-${notice.id}` ? { sent: true, outcome: "SENT", providerMessageId: "msg_a" } : { sent: false, outcome: "NOT_ATTEMPTED" },
    );
    const real = prisma.customerNotice.updateMany.bind(prisma.customerNotice);
    const spy = vi.spyOn(prisma.customerNotice, "updateMany").mockImplementation(((args: { data?: { status?: string } }) =>
      args?.data?.status === "SENT" ? Promise.reject(new Error("db down")) : real(args as never)) as never);
    try {
      await sendPendingNotices(inReminderWindow);
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe("SENDING");

    // The customer's email changes after the claim: the frozen address is still the one used.
    await prisma.user.update({ where: { id: fx.userId }, data: { email: `changed-${fx.tag}@example.test` } });
    try {
      emailMock.send.mockClear();
      await sendPendingNotices(new Date(inReminderWindow.getTime() + 20 * 60_000));
      const calls = emailMock.send.mock.calls.map((c) => c[0]).filter((c) => c.idempotencyKey === `customer-notice-${notice.id}`);
      expect(calls).toHaveLength(1);
      expect(calls[0].to).toBe(frozen);
      const after = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });
      expect(after.status).toBe("SENT");
      expect(after.providerMessageId).toBe("msg_a");
    } finally {
      await prisma.user.update({ where: { id: fx.userId }, data: { email: frozen } });
    }
  });

  it("notice-stale-claim-under-23h-retried-over-23h-uncertain", async () => {
    const young = (await reminder()).notice;
    const old = (await reminder()).notice;
    await prisma.customerNotice.update({
      where: { id: young.id },
      data: { status: "SENDING", claimToken: "dead-run", sentToAddress: "a@example.test", lastAttemptAt: new Date(inReminderWindow.getTime() - 22 * HOUR) },
    });
    await prisma.customerNotice.update({
      where: { id: old.id },
      data: { status: "SENDING", claimToken: "dead-run", sentToAddress: "b@example.test", lastAttemptAt: new Date(inReminderWindow.getTime() - 24 * HOUR) },
    });
    await sendPendingNotices(inReminderWindow);
    expect(emailMock.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${young.id}`, to: "a@example.test" }));
    expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${old.id}` }));
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: young.id } })).status).toBe("SENT");
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("UNCERTAIN");
  });

  it("notice-stale-worker-completion-ignored-after-takeover", async () => {
    const { notice } = await reminder();
    emailMock.send.mockImplementation(async (input: { idempotencyKey?: string }) => {
      if (input.idempotencyKey !== `customer-notice-${notice.id}`) return { sent: false, outcome: "NOT_ATTEMPTED" };
      // While this worker waits for the email service, another worker takes the claim over.
      await prisma.customerNotice.update({ where: { id: notice.id }, data: { claimToken: "newer-worker" } });
      return { sent: true, outcome: "SENT", providerMessageId: "msg_late" };
    });
    await sendPendingNotices(inReminderWindow);
    const after = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });
    expect(after.status).toBe("SENDING");
    expect(after.claimToken).toBe("newer-worker");
    expect(after.providerMessageId).toBeNull();
  });

  it("notice-third-rejection-failed: a refusal waits a day, the third one makes it FAILED", async () => {
    const { notice } = await reminder();
    emailMock.send.mockImplementation(async (input: { idempotencyKey?: string }) =>
      input.idempotencyKey === `customer-notice-${notice.id}` ? { sent: false, outcome: "REJECTED" } : { sent: false, outcome: "NOT_ATTEMPTED" },
    );
    await sendPendingNotices(inReminderWindow);
    let row = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });
    expect([row.status, row.attempts]).toEqual(["PENDING", 1]);
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 20 * HOUR);
    // Not due again until its retry time.
    emailMock.send.mockClear();
    await sendPendingNotices(inReminderWindow);
    expect(emailMock.send).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `customer-notice-${notice.id}` }));
    for (let i = 0; i < 2; i += 1) {
      await prisma.customerNotice.update({ where: { id: notice.id }, data: { nextAttemptAt: null } });
      await sendPendingNotices(inReminderWindow);
    }
    row = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });
    expect([row.status, row.attempts]).toEqual(["FAILED", 3]);
    expect(row.nextAttemptAt).toBeNull();
  });

  it("notice-201-with-200-failing-last-one-attempted: each run takes at most 50, earliest deadline first, and failures back off", async () => {
    const base = Date.now();
    const rows = Array.from({ length: 201 }, (_, i) => ({
      customerId: fx.customerId,
      kind: "TERMS_CHANGE",
      dedupeKey: `bulk-${fx.tag}-${i}`,
      subject: "s",
      body: "b",
      deadlineAt: new Date(base + 30 * 86_400_000 + i * 1000),
    }));
    await prisma.customerNotice.createMany({ data: rows });
    const failing = new Set(rows.slice(0, 200).map((r) => r.dedupeKey));
    const idByKey = new Map(
      (await prisma.customerNotice.findMany({ where: { dedupeKey: { startsWith: `bulk-${fx.tag}-` } }, select: { id: true, dedupeKey: true } })).map((r) => [r.id, r.dedupeKey]),
    );
    emailMock.send.mockImplementation(async (input: { idempotencyKey?: string }) => {
      const id = input.idempotencyKey?.replace("customer-notice-", "") ?? "";
      const key = idByKey.get(id);
      if (!key) return { sent: false, outcome: "NOT_ATTEMPTED" };
      return failing.has(key) ? { sent: false, outcome: "REJECTED" } : { sent: true, outcome: "SENT" };
    });
    const lastId = [...idByKey.entries()].find(([, key]) => key === rows[200]!.dedupeKey)![0];
    let runs = 0;
    while (runs < 6) {
      runs += 1;
      await sendPendingNotices(new Date());
      const last = await prisma.customerNotice.findUniqueOrThrow({ where: { id: lastId } });
      if (last.status === "SENT") break;
    }
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: lastId } })).status).toBe("SENT");
    // 200 failing notices at 50 per run: the good one is reached on the fifth run, never starved.
    expect(runs).toBeLessThanOrEqual(5);
    await prisma.customerNotice.deleteMany({ where: { dedupeKey: { startsWith: `bulk-${fx.tag}-` } } });
  });
});
