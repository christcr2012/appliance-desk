import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: (...a: unknown[]) => m.send(...a),
}));

import { sendEstimate } from "@/domains/estimates";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("R10 initial estimate send is one claimed transition", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `r10-user-${tag}`;
  const customerId = `r10-customer-${tag}`;
  const ids: string[] = [];

  async function draft() {
    const row = await prisma.estimate.create({
      data: {
        customerId,
        createdByUserId: userId,
        title: "R10",
        lineItems: { create: { description: "Washer", monthlyPriceCents: 3000, quantity: 1 } },
      },
    });
    ids.push(row.id);
    return row.id;
  }
  const load = (id: string) => prisma.estimate.findUniqueOrThrow({ where: { id } });
  const keyOf = (call: number) =>
    (m.send.mock.calls[call]![0] as { idempotencyKey: string }).idempotencyKey;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, name: "R10", role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `R10${tag.slice(0, 15)}` },
    });
  });
  beforeEach(() => m.send.mockReset().mockResolvedValue({ state: "ACCEPTED", deliveryId: "delivery", providerMessageId: "provider" }));
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.estimateLineItem.deleteMany({ where: { estimateId: { in: ids } } });
    await prisma.estimate.deleteMany({ where: { id: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("two overlapping sends produce exactly one email attempt", async () => {
    const id = await draft();
    const results = await Promise.allSettled([
      sendEstimate(userId, id),
      sendEstimate(userId, id),
      sendEstimate(userId, id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(m.send).toHaveBeenCalledTimes(1);
    expect((await load(id)).status).toBe("SENT");
  });

  it("the email key is built from the stored send time", async () => {
    const id = await draft();
    await sendEstimate(userId, id);
    expect(keyOf(0)).toBe(`estimate-send-${id}-${(await load(id)).sentAt!.getTime()}`);
  });

  it("a deliberate re-send after changes were requested gets a new identity", async () => {
    const id = await draft();
    await sendEstimate(userId, id);
    await prisma.estimate.update({ where: { id }, data: { status: "CHANGES_REQUESTED" } });
    await sendEstimate(userId, id);
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it.each([
    ["REJECTED", "FAILED"],
    ["UNKNOWN", "UNKNOWN"],
  ] as const)("%s leaves owner-visible evidence and no automatic replay", async (outcome, state) => {
    m.send.mockResolvedValue({ state, deliveryId: "delivery", providerMessageId: null });
    const id = await draft();
    expect(await sendEstimate(userId, id)).toEqual({ emailed: false, outcome });
    expect(m.send).toHaveBeenCalledTimes(1);
    const evidence = await prisma.auditLog.findFirst({
      where: { entityId: id, action: "estimate.send_email_unconfirmed" },
    });
    expect((evidence?.newValue as { outcome: string }).outcome).toBe(outcome);
  });

  it("NOT_ATTEMPTED (email switched off) is not treated as a failure", async () => {
    m.send.mockResolvedValue({ state: "NOT_SENT", deliveryId: "delivery", providerMessageId: null });
    const id = await draft();
    await sendEstimate(userId, id);
    expect(
      await prisma.auditLog.count({ where: { entityId: id, action: "estimate.send_email_unconfirmed" } }),
    ).toBe(0);
  });
});
