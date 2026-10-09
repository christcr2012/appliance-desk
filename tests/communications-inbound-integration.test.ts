import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ingestVerifiedSms } from "@/domains/messaging/inbound-sms";
import { decryptCommunicationContent } from "@/domains/messaging/communications-content";

const endpoint = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const isolated = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(endpoint.hostname) &&
  endpoint.pathname === "/appliance_desk_test";

describe.skipIf(!isolated)("COM-L5A verified inbound SMS integrity", () => {
  const p = "inbound-" + randomUUID().slice(0, 9);
  const userId = p + "-user";
  const customerId = p + "-customer";
  const otherCustomerId = p + "-other";
  const otherUserId = p + "-user2";
  const accountId = p + "-account";
  const numberId = p + "-number";
  const from = "+13035559851";
  const to = "+13035559852";
  const sid = "AC" + "c".repeat(32);
  const prevSid = process.env.TWILIO_ACCOUNT_SID;
  const prevKey = process.env.COMMUNICATION_CONTENT_KEY;
  const message = (mark: string) => ({
    accountSid: sid, messageSid: "SM" + mark.repeat(32),
    from, to, text: "Private inbound " + p, mediaCount: 0,
  });

  beforeAll(async () => {
    process.env.TWILIO_ACCOUNT_SID = sid;
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    await prisma.user.create({ data: { id: userId, email: p + "@example.test", role: "OWNER" } });
    await prisma.user.create({ data: { id: otherUserId, email: p + "-other@example.test", role: "CUSTOMER" } });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: p },
    });
    await prisma.customer.create({
      data: { id: otherCustomerId, userId: otherUserId, referralCode: p + "-other" },
    });
    await prisma.telecomAccount.create({ data: {
      id: accountId, environment: "PRODUCTION", provider: "twilio",
      externalAccountId: sid, status: "READY", label: p + "-isolated",
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: numberId, accountId, address: to, providerNumberId: p + "-provider",
      capabilities: { sms: true }, registrationStatus: "APPROVED",
      verifiedAt: new Date(),
    } });
  });
  afterAll(async () => {
    const point = await prisma.contactPoint.findUnique({
      where: { environment_channel_address: {
        environment: "PRODUCTION", channel: "SMS", address: from,
      } },
    });
    const threadIds = (await prisma.communicationThread.findMany({
      where: { accountId }, select: { id: true },
    })).map((row) => row.id);
    await prisma.auditLog.deleteMany({
      where: { entityType: "CommunicationThread", entityId: { in: threadIds } },
    });
    if (point) {
      await prisma.contactBinding.deleteMany({ where: { contactPointId: point.id } });
      await prisma.communicationMessage.deleteMany({ where: { accountId } });
      await prisma.communicationThread.deleteMany({ where: { accountId } });
      await prisma.contactPoint.delete({ where: { id: point.id } });
    }
    await prisma.providerEvent.deleteMany({ where: { telecomAccountId: accountId } });
    await prisma.businessPhoneNumber.delete({ where: { id: numberId } });
    await prisma.telecomAccount.delete({ where: { id: accountId } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    if (prevSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = prevSid;
    if (prevKey === undefined) delete process.env.COMMUNICATION_CONTENT_KEY;
    else process.env.COMMUNICATION_CONTENT_KEY = prevKey;
  });

  it("records one private unresolved inbound message, not an outgoing send", async () => {
    const first = await ingestVerifiedSms(message("a"));
    expect(first).toMatchObject({ duplicate: false, resolution: "UNRESOLVED" });
    const thread = await prisma.communicationThread.findUniqueOrThrow({
      where: { id: first.threadId! },
    });
    expect(thread.customerId).toBeNull();
    expect(thread.leadId).toBeNull();
    const persisted = await prisma.communicationMessage.findUniqueOrThrow({
      where: { id: first.messageId! },
    });
    expect(persisted.direction).toBe("INBOUND");
    expect(persisted.deliveryId).toBeNull();
    expect(persisted.bodyEncrypted).not.toContain(p);
    expect(decryptCommunicationContent(persisted.bodyEncrypted!)).toBe(message("a").text);
    const event = await prisma.providerEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: "twilio", eventId: "sms-inbound:" + message("a").messageSid } },
    });
    expect(JSON.stringify(event.summary)).not.toContain(p);
    expect(await prisma.messageDelivery.count({ where: { telecomAccountId: accountId } })).toBe(0);
  });
  it("does not duplicate SID on replay or re-encrypt another row", async () => {
    const first = await ingestVerifiedSms(message("a"));
    expect(first).toMatchObject({ duplicate: true });
    expect(await prisma.communicationMessage.count({
      where: { accountId, providerResourceId: message("a").messageSid },
    })).toBe(1);
  });
  it("resolves only verified binding; ambiguous shared numbers expose no customer", async () => {
    const point = await prisma.contactPoint.findUniqueOrThrow({
      where: { environment_channel_address: {
        environment: "PRODUCTION", channel: "SMS", address: from,
      } },
    });
    await prisma.contactBinding.create({ data: {
      contactPointId: point.id, customerId, source: "STAFF", verifiedAt: new Date(),
    } });
    const result = await ingestVerifiedSms(message("b"));
    expect(result.resolution).toBe("RESOLVED");
    expect((await prisma.communicationThread.findUniqueOrThrow({
      where: { id: result.threadId! },
    })).customerId).toBe(customerId);

    await prisma.contactBinding.create({ data: {
      contactPointId: point.id, customerId: otherCustomerId,
      source: "STAFF", verifiedAt: new Date(),
    } });
    const shared = await ingestVerifiedSms(message("d"));
    expect(shared.resolution).toBe("AMBIGUOUS");
    const thread = await prisma.communicationThread.findUniqueOrThrow({
      where: { id: shared.threadId! },
    });
    expect(thread.customerId).toBeNull();
    expect(thread.leadId).toBeNull();
    expect(await prisma.communicationMessage.count({
      where: { threadId: thread.id },
    })).toBe(3);
  });
  it("rejects wrong account, receiving number and oversized payload", async () => {
    await expect(ingestVerifiedSms({ ...message("e"),
      accountSid: "AC" + "b".repeat(32),
    })).rejects.toThrow();
    await expect(ingestVerifiedSms({ ...message("f"),
      to: "+13035550999",
    })).rejects.toThrow();
    await expect(ingestVerifiedSms({ ...message("0"),
      text: "x".repeat(12_001),
    })).rejects.toThrow();
  });
});
