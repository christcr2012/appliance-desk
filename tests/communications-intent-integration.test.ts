import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestCommunication } from "@/domains/messaging/request-communication";
import { saveCommunicationsPolicy } from "@/domains/messaging/communications-policy";
import { decryptCommunicationContent } from "@/domains/messaging/communications-content";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-L4A immutable intents (isolated PostgreSQL)", () => {
  const unique = randomUUID().slice(0, 10);
  const name = "intent-" + unique;
  const actor = name + "-owner";
  const admin = name + "-admin";
  const accountId = name + "-acct";
  const phoneId = name + "-number";
  const pointId = name + "-contact";
  const threadId = name + "-thread";
  const customerId = name + "-customer";
  const recipient = "+13035550137";
  const sender = "+13035550138";
  const keyBefore = process.env.COMMUNICATION_CONTENT_KEY;
  let oldSettings: {
    customerSmsEnabled: boolean;
    communicationsPolicy: unknown;
    communicationsPolicyVersion: number;
  };

  const policy = (version: number) => ({
    schemaVersion: 1 as const,
    manualSmsEnabled: true, primaryAccountId: accountId, primaryNumberId: phoneId,
    approvedPolicyVersion: version, maxSegments: 3,
    supportedCountries: ["US" as const],
  });

  beforeAll(async () => {
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true,
        communicationsPolicyVersion: true },
    });
    oldSettings = settings;
    await prisma.user.create({ data: { id: actor, email: name + "@example.test", role: "OWNER" } });
    await prisma.user.create({ data: { id: admin, email: name + "-admin@example.test", role: "ADMIN" } });
    await prisma.customer.create({ data: {
      id: customerId, userId: actor, referralCode: name,
    } });
    await prisma.telecomAccount.create({ data: {
      id: accountId, environment: "TEST", provider: "twilio",
      externalAccountId: name, label: "TEST only", status: "READY",
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: phoneId, accountId, address: sender, providerNumberId: phoneId,
      capabilities: { sms: true, voice: false }, verifiedAt: new Date(),
      registrationStatus: "APPROVED",
    } });
    await prisma.contactPoint.create({ data: {
      id: pointId, environment: "TEST", channel: "SMS",
      address: recipient,
    } });
    await prisma.communicationThread.create({ data: {
      id: threadId, accountId, businessNumberId: phoneId,
      externalContactPointId: pointId, customerId, resolution: "RESOLVED",
    } });
    await prisma.consentRecord.create({ data: {
      id: name + "-grant", kind: "test-affirmative-grant",
      contactPointId: pointId, customerId, purpose: "SMS_CONVERSATIONAL",
      action: "GRANT", source: "SIGNED_DISCLOSURE",
      occurredAt: new Date(Date.now() - 60_000),
      disclosureVersion: "v1", textHash: "test-written-evidence",
      scope: { businessNumberId: phoneId },
    } });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { customerSmsEnabled: false, communicationsPolicy: policy(settings.communicationsPolicyVersion) } });
  });

  afterAll(async () => {
    await prisma.messageDelivery.updateMany({ where: { idempotencyKey: { startsWith: "com:v1:" + name } },
      data: { currentAttemptId: null } });
    await prisma.communicationMessage.deleteMany({ where: { threadId } });
    await prisma.messageAttempt.deleteMany({ where: { operationKey: { startsWith: "com:v1:" + name } } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { startsWith: "com:v1:" + name } } });
    await prisma.communicationThread.deleteMany({ where: { id: threadId } });
    await prisma.marketingSuppression.deleteMany({ where: { channel: "SMS", address: recipient } });
    await prisma.consentRecord.deleteMany({ where: { contactPointId: pointId } });
    await prisma.contactPoint.deleteMany({ where: { id: pointId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: phoneId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [actor, admin] } } });
    await prisma.user.deleteMany({ where: { id: { in: [actor, admin] } } });
    if (oldSettings) await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { customerSmsEnabled: oldSettings.customerSmsEnabled,
        communicationsPolicy: oldSettings.communicationsPolicy as object,
        communicationsPolicyVersion: oldSettings.communicationsPolicyVersion } });
    if (keyBefore === undefined) delete process.env.COMMUNICATION_CONTENT_KEY;
    else process.env.COMMUNICATION_CONTENT_KEY = keyBefore;
  });

  it("fails closed on outer master switch and never creates an intent", async () => {
    const response = await requestCommunication(actor, { threadId, expectedThreadVersion: 1,
      operationKey: name + "-disabled", body: "Don't send" });
    expect(response).toEqual({ kind: "BLOCKED", reason: "MASTER_OFF" });
    expect(await prisma.messageDelivery.count({ where: { subjectId: threadId } })).toBe(0);
  });

  it("refuses customer actor and missing key without persisting anything", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" }, data: { customerSmsEnabled: true },
    });
    const customer = await prisma.user.create({
      data: { id: name + "-portal", email: name + "-portal@example.test", role: "CUSTOMER" },
    });
    try {
      await expect(requestCommunication(customer.id, {
        threadId, expectedThreadVersion: 1, operationKey: name + "-customer", body: "Denied",
      })).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: customer.id } });
    }
    const savedKey = process.env.COMMUNICATION_CONTENT_KEY;
    delete process.env.COMMUNICATION_CONTENT_KEY;
    try {
      await expect(requestCommunication(actor, {
        threadId, expectedThreadVersion: 1, operationKey: name + "-missing-key", body: "Denied",
      })).rejects.toThrow();
    } finally {
      process.env.COMMUNICATION_CONTENT_KEY = savedKey;
    }
    expect(await prisma.messageDelivery.count({ where: { subjectId: threadId } })).toBe(0);
  });

  it("atomically prepares encrypted evidence and replays only identical operations", async () => {
    const input = { threadId, expectedThreadVersion: 1,
      operationKey: name + "-first", body: "Private appointment detail" };
    const first = await requestCommunication(actor, input);
    expect(first).toMatchObject({ kind: "QUEUED", replay: false });
    if (first.kind !== "QUEUED") throw new Error("First intent not queued");
    const delivery = await prisma.messageDelivery.findUniqueOrThrow({
      where: { id: first.deliveryId },
    });
    expect(delivery.state).toBe("PENDING");
    expect(delivery.renderedBody).not.toContain(input.body);
    expect(decryptCommunicationContent(delivery.renderedBody!)).toBe(input.body);
    expect(delivery.currentAttemptId).toBe(first.attemptId);
    const message = await prisma.communicationMessage.findUniqueOrThrow({
      where: { deliveryId: first.deliveryId },
    });
    expect(message.id).toBe(first.messageId);
    expect(message.consentRecordId).toBe(name + "-grant");
    expect(await requestCommunication(actor, input)).toEqual({ ...first, replay: true });
    expect(await requestCommunication(actor, { ...input, body: "changed" })).toEqual({ kind: "CONFLICT" });
    expect(await prisma.messageAttempt.count({ where: { deliveryId: first.deliveryId } })).toBe(1);
    expect(await requestCommunication(actor, { ...input, operationKey: name + "-stale" }))
      .toEqual({ kind: "CONFLICT" });
  });

  it("concurrent calls with the same operation key create only one intent", async () => {
    const version = (await prisma.communicationThread.findUniqueOrThrow({
      where: { id: threadId },
    })).version;
    const input = { threadId, expectedThreadVersion: version,
      operationKey: name + "-concurrent", body: "One frozen message only" };
    const [one, two] = await Promise.all([
      requestCommunication(actor, input), requestCommunication(actor, input),
    ]);
    expect(one.kind).toBe("QUEUED");
    expect(two.kind).toBe("QUEUED");
    if (one.kind !== "QUEUED" || two.kind !== "QUEUED") return;
    expect(one.deliveryId).toBe(two.deliveryId);
    expect(new Set([one.replay, two.replay])).toEqual(new Set([true, false]));
    expect(await prisma.messageAttempt.count({
      where: { deliveryId: one.deliveryId },
    })).toBe(1);
  });

  it("existing STOP suppression blocks every purpose under the same address lock", async () => {
    await prisma.marketingSuppression.create({ data: {
      channel: "SMS", address: recipient, reason: "STOP", source: "TEST",
    } });
    const version = (await prisma.communicationThread.findUniqueOrThrow({ where: { id: threadId } })).version;
    expect(await requestCommunication(actor, {
      threadId, expectedThreadVersion: version,
      operationKey: name + "-stopped", body: "Do not send",
    })).toEqual({ kind: "BLOCKED", reason: "SUPPRESSED" });
    await prisma.marketingSuppression.delete({ where: {
      channel_address: { channel: "SMS", address: recipient },
    } });
  });

  it("OWNER policy updates require version match; ADMIN cannot update", async () => {
    const version = (await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    })).communicationsPolicyVersion;
    await expect(saveCommunicationsPolicy(admin, policy(version + 1), version)).rejects.toThrow();
    const result = await saveCommunicationsPolicy(actor, policy(version + 1), version);
    expect(result.version).toBe(version + 1);
    await expect(saveCommunicationsPolicy(actor, policy(version + 1), version)).rejects.toThrow();
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).customerSmsEnabled).toBe(true);
  });
});
