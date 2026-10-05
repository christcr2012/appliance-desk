import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/customer-email", () => ({
  sendCustomerEmail: (...a: unknown[]) => m.send(...a),
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
  // The sweep is global, so only count emails for this suite's estimates.
  const mine = () =>
    m.send.mock.calls.filter((c) => ids.some((id) => (c[0] as { idempotencyKey: string }).idempotencyKey.includes(id)));

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "FU", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `FU${tag.slice(0, 16)}` } });
  });
  beforeEach(() => m.send.mockReset().mockResolvedValue({ sent: true, outcome: "SENT" }));
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

  it("email switched off gives the claim back so it goes out once email is on", async () => {
    const id = await awaitingEstimate();
    m.send.mockResolvedValue({ sent: false, outcome: "NOT_ATTEMPTED" });
    await sendEstimateFollowUpReminders();
    expect((await load(id)).followUpSentForSentAt).toBeNull();
    m.send.mockResolvedValue({ sent: true, outcome: "SENT" });
    await sendEstimateFollowUpReminders();
    expect((await load(id)).followUpSentForSentAt).not.toBeNull();
  });

  it("an unknown outcome keeps the claim, so a lost response is never emailed twice", async () => {
    const id = await awaitingEstimate();
    m.send.mockResolvedValue({ sent: false, outcome: "UNKNOWN" });
    await sendEstimateFollowUpReminders();
    expect((await load(id)).followUpSentForSentAt).not.toBeNull();
    m.send.mockClear();
    await sendEstimateFollowUpReminders();
    expect(mine()).toHaveLength(0);
  });

  it("a crash after the send leaves the claim in place (no second email on the next run)", async () => {
    const id = await awaitingEstimate();
    // Simulate: claim written, process dies before anything else is recorded.
    const row = await load(id);
    await prisma.estimate.update({ where: { id }, data: { followUpSentForSentAt: row.sentAt } });
    await sendEstimateFollowUpReminders();
    expect(mine()).toHaveLength(0);
  });
});
