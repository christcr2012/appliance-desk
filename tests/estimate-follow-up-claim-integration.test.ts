import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...args: unknown[]) => m.send(...args),
}));

import { sendEstimateFollowUpReminders } from "@/domains/estimates";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("estimate follow-up is claimed before it is sent (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `fu-user-${tag}`;
  const customerId = `fu-customer-${tag}`;
  const ids: string[] = [];
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  async function awaitingEstimate() {
    const row = await prisma.estimate.create({
      data: { customerId, createdByUserId: userId, title: "FU", status: "SENT", sentAt: daysAgo(5) },
    });
    ids.push(row.id);
    return row.id;
  }
  const load = (id: string) => prisma.estimate.findUniqueOrThrow({ where: { id } });
  const mine = () =>
    m.send.mock.calls.filter((c) => ids.some((id) => (c[0] as { idempotencyKey: string }).idempotencyKey.includes(id)));

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "FU", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `FU${tag.slice(0, 16)}` } });
  });
  beforeEach(() => m.send.mockReset().mockResolvedValue({ state: "ACCEPTED", deliveryId: "delivery", providerMessageId: "provider" }));
  afterAll(async () => {
    await prisma.estimate.deleteMany({ where: { id: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("three overlapping runs send exactly one follow-up for the estimate", async () => {
    const id = await awaitingEstimate();
    await Promise.all([sendEstimateFollowUpReminders(), sendEstimateFollowUpReminders(), sendEstimateFollowUpReminders()]);
    expect(mine()).toHaveLength(1);
    const row = await load(id);
    expect(row.followUpSentForSentAt?.getTime()).toBe(row.sentAt!.getTime());
  });

  it("a later run does not send it again", async () => {
    await awaitingEstimate();
    await sendEstimateFollowUpReminders();
    const first = mine().length;
    await sendEstimateFollowUpReminders();
    expect(mine()).toHaveLength(first);
  });

  it("NOT_SENT gives the claim back so it can go out once email is on", async () => {
    const id = await awaitingEstimate();
    m.send.mockResolvedValue({ state: "NOT_SENT", deliveryId: "delivery", providerMessageId: null });
    await sendEstimateFollowUpReminders();
    expect((await load(id)).followUpSentForSentAt).toBeNull();
    m.send.mockResolvedValue({ state: "ACCEPTED", deliveryId: "delivery", providerMessageId: "provider" });
    await sendEstimateFollowUpReminders();
    expect((await load(id)).followUpSentForSentAt).not.toBeNull();
  });

  it("UNKNOWN keeps the claim, so a lost response is never emailed twice", async () => {
    const id = await awaitingEstimate();
    m.send.mockResolvedValue({ state: "UNKNOWN", deliveryId: "delivery", providerMessageId: null });
    await sendEstimateFollowUpReminders();
    expect((await load(id)).followUpSentForSentAt).not.toBeNull();
    m.send.mockClear();
    await sendEstimateFollowUpReminders();
    expect(mine()).toHaveLength(0);
  });
});
