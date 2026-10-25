import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getServiceMetrics } from "@/domains/messaging/telecom-unit-economics";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-N4 service metrics (isolated PostgreSQL)", () => {
  const name = "n4-" + randomUUID().slice(0, 8);
  const owner = name + "-o", staff = name + "-s", cust = name + "-c";
  const accountId = name + "-a", numberId = name + "-n", customerId = name + "-cust";
  const day = new Date("2026-03-10T15:00:00Z");
  const from = new Date("2026-03-10T00:00:00Z"), to = new Date("2026-03-10T00:00:00Z");
  let pointId = "", threadId = "";

  beforeAll(async () => {
    for (const [id, role] of [[owner, "OWNER"], [staff, "STAFF"], [cust, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: id + "@example.test", role } });
    }
    await prisma.customer.create({ data: { id: customerId, userId: cust, referralCode: name } });
    await prisma.telecomAccount.create({ data: { id: accountId, environment: "PRODUCTION", provider: "twilio", externalAccountId: name, label: "n4", status: "READY" } });
    await prisma.businessPhoneNumber.create({ data: { id: numberId, accountId, address: "+13035550188", providerNumberId: numberId, capabilities: {} } });
    const p = await prisma.contactPoint.create({ data: { environment: "PRODUCTION", channel: "SMS", address: "+13035550166" } });
    pointId = p.id;
    const t = await prisma.communicationThread.create({ data: { accountId, businessNumberId: numberId, externalContactPointId: pointId,
      customerId, resolution: "RESOLVED", status: "OPEN" } });
    threadId = t.id;
    const states = [...Array(10).fill("DELIVERED"), "FAILED", "FAILED"];
    for (const [i, state] of states.entries()) {
      await prisma.messageDelivery.create({ data: { idempotencyKey: `${name}-${i}`, channel: "SMS", purpose: "TRANSACTIONAL", templateKey: "t",
        recipientType: "CUSTOMER", recipientAddress: `+1303555${String(2000 + i)}`, state, requestedAt: day, environment: "PRODUCTION" } });
    }
    await prisma.communicationMessage.create({ data: { threadId, accountId, direction: "INBOUND", bodyHash: "h1", redactedAt: new Date("2026-03-10T16:00:01Z"), occurredAt: new Date("2026-03-10T16:00:00Z") } });
    const reply = await prisma.messageDelivery.create({ data: { idempotencyKey: `${name}-reply`, channel: "SMS", purpose: "CONVERSATIONAL",
      templateKey: "t", recipientType: "CUSTOMER", recipientAddress: "+13035559999", telecomAccountId: accountId, state: "NOT_SENT", requestedAt: day, environment: "PRODUCTION" } });
    await prisma.communicationMessage.create({ data: { threadId, accountId, direction: "OUTBOUND", deliveryId: reply.id, bodyHash: "h2", actorUserId: staff, occurredAt: new Date("2026-03-10T16:12:00Z") } });
  });

  afterAll(async () => {
    await prisma.communicationMessage.deleteMany({ where: { threadId } });
    await prisma.communicationThread.deleteMany({ where: { id: threadId } });
    await prisma.contactPoint.deleteMany({ where: { id: pointId } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { startsWith: name } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, cust] } } });
  });

  it("counts final text results and the first person reply; sparse samples are unavailable", async () => {
    const m = await getServiceMetrics(owner, from, to);
    expect(m.texts.delivered).toBeGreaterThanOrEqual(10);
    expect(m.texts.failed).toBeGreaterThanOrEqual(2);
    expect(m.texts.sampleEnough).toBe(true);
    expect(m.texts.failureRate).not.toBeNull();
    expect(m.response.samples).toBeGreaterThanOrEqual(1);
    expect(m.response.medianMinutes).not.toBeNull();
    const empty = await getServiceMetrics(owner, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-02T00:00:00Z"));
    expect(empty.texts.failureRate).toBeNull();
    expect(empty.optOuts.rate).toBeNull();
    expect(empty.response.medianMinutes).toBeNull();
  });

  it("only owner or admin may read it; windows over 93 days are refused", async () => {
    await expect(getServiceMetrics(staff, from, to)).rejects.toThrow();
    await expect(getServiceMetrics(cust, from, to)).rejects.toThrow();
    await expect(getServiceMetrics(owner, new Date("2026-01-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"))).rejects.toThrow("INVALID_METRICS_WINDOW");
  });
});
