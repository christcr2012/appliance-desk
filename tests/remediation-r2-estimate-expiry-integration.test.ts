import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approveEstimate, requestEstimateChanges } from "@/domains/estimates";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("R09 an expired estimate cannot be answered", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `r9-user-${tag}`;
  const customerId = `r9-customer-${tag}`;
  const estimateIds: string[] = [];
  const leadIds: string[] = [];

  const input = {
    approverName: "Pat Customer",
    approverEmail: `pat-${tag}@example.test`,
    ipAddress: "203.0.113.9",
  };

  async function estimate(validUntil: Date | null, status: "SENT" | "VIEWED" = "SENT") {
    const row = await prisma.estimate.create({
      data: { customerId, createdByUserId: userId, title: "R9", status, validUntil, sentAt: new Date() },
    });
    estimateIds.push(row.id);
    return row.id;
  }
  const load = (id: string) => prisma.estimate.findUniqueOrThrow({ where: { id } });
  const yesterday = () => new Date(Date.now() - 2 * 86_400_000);
  const nextWeek = () => new Date(Date.now() + 7 * 86_400_000);

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, name: "R9", role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `R9${tag.slice(0, 16)}` },
    });
  });

  afterAll(async () => {
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("approving after the deadline is refused, and the estimate is recorded as EXPIRED", async () => {
    const id = await estimate(yesterday());
    await expect(approveEstimate(id, input)).rejects.toThrow(/expired/i);
    const after = await load(id);
    expect(after.status).toBe("EXPIRED");
    expect(after.approverName).toBeNull();
    expect(after.respondedAt).toBeNull();
  });

  it("requesting changes after the deadline is refused too", async () => {
    const id = await estimate(yesterday(), "VIEWED");
    await expect(requestEstimateChanges(id, "Can you lower it?")).rejects.toThrow(/expired/i);
    const after = await load(id);
    expect(after.status).toBe("EXPIRED");
    expect(after.changesRequestedMessage).toBeNull();
  });

  it("an expired estimate from a lead does not create a customer", async () => {
    const lead = await prisma.lead.create({
      data: { contactName: "R9 Lead", phone: "3035550100", email: `lead-${tag}@example.test` },
    });
    leadIds.push(lead.id);
    const row = await prisma.estimate.create({
      data: { leadId: lead.id, createdByUserId: userId, title: "R9 lead", status: "SENT", validUntil: yesterday(), sentAt: new Date() },
    });
    estimateIds.push(row.id);

    await expect(approveEstimate(row.id, input)).rejects.toThrow(/expired/i);

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).not.toBe("CONVERTED");
    expect((await load(row.id)).customerId).toBeNull();
  });

  it("a still-valid estimate and one with no deadline can be approved", async () => {
    const valid = await estimate(nextWeek());
    const open = await estimate(null);
    await approveEstimate(valid, input);
    await approveEstimate(open, input);
    expect((await load(valid)).status).toBe("APPROVED");
    expect((await load(open)).status).toBe("APPROVED");
  });

  it("the last second of the valid-through day still works", async () => {
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());
    const { businessDateEnd } = await import("@/lib/business-date");
    const id = await estimate(businessDateEnd(dayKey));
    await approveEstimate(id, input);
    expect((await load(id)).status).toBe("APPROVED");
  });
});
