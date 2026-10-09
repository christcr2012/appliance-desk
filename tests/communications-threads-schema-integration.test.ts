import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BACKUP_TABLES, BACKUP_MODEL_POLICY } from "@/domains/backup/manifest";
import { deriveRestoreTableOrder } from "../scripts/lib/table-order";

const endpoint = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(endpoint.hostname) &&
  endpoint.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-L3 schema integrity in isolated PostgreSQL", () => {
  const key = "coml3-" + randomUUID().slice(0, 12);
  const user = key + "-user";
  const secondUser = key + "-staff";
  const acct = key + "-acct";
  const otherAcct = key + "-otheracct";
  const number = key + "-number";
  const point = key + "-point";
  const otherPoint = key + "-otherpoint";
  const prodPoint = key + "-prodpoint";
  const thread = key + "-thread";
  const otherThread = key + "-otherthread";
  const incoming = key + "-incoming";
  const delivery = key + "-delivery";
  const now = new Date("2026-10-09T12:00:00.000Z");

  beforeAll(async () => {
    await prisma.user.create({ data: { id: user, email: key + "@example.test", role: "OWNER" } });
    await prisma.user.create({ data: { id: secondUser, email: key + "-staff@example.test", role: "ADMIN" } });
    await prisma.customer.create({ data: {
      id: key + "-customer", userId: user, referralCode: key,
    } });
    await prisma.lead.create({ data: {
      id: key + "-lead", contactName: "COM schema test", phone: "+13035550007",
    } });
    for (const [id, suffix] of [[acct, ""], [otherAcct, "-other"]]) {
      await prisma.telecomAccount.create({ data: {
        id, provider: "twilio", environment: "TEST",
        externalAccountId: key + "-sid" + suffix, label: "isolated test",
      } });
    }
    await prisma.businessPhoneNumber.create({ data: {
      id: number, accountId: acct, address: "+13035550002", providerNumberId: key + "-pn",
    } });
    for (const [id, environment, address] of [
      [point, "TEST", "+13035550003"],
      [otherPoint, "TEST", "+13035550004"],
      [prodPoint, "PRODUCTION", "+13035550005"],
    ] as const) {
      await prisma.contactPoint.create({ data: { id, environment, channel: "SMS", address } });
    }
    await prisma.communicationThread.create({ data: {
      id: thread, accountId: acct, businessNumberId: number, externalContactPointId: point,
    } });
    await prisma.communicationThread.create({ data: {
      id: otherThread, accountId: acct, businessNumberId: number, externalContactPointId: otherPoint,
    } });
  });

  afterAll(async () => {
    await prisma.communicationReadMarker.deleteMany({ where: { threadId: { startsWith: key } } });
    await prisma.communicationLink.deleteMany({ where: { id: { startsWith: key } } });
    await prisma.communicationMessage.deleteMany({ where: { threadId: { startsWith: key } } });
    await prisma.communicationThread.deleteMany({ where: { id: { startsWith: key } } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { startsWith: key } } });
    await prisma.communicationTemplateRevision.deleteMany({ where: { key: { startsWith: key } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { accountId: { in: [acct, otherAcct] } } });
    await prisma.contactPoint.deleteMany({ where: { id: { startsWith: key } } });
    await prisma.telecomAccount.deleteMany({ where: { id: { in: [acct, otherAcct] } } });
    await prisma.lead.deleteMany({ where: { id: key + "-lead" } });
    await prisma.customer.deleteMany({ where: { id: key + "-customer" } });
    await prisma.user.deleteMany({ where: { id: { in: [user, secondUser] } } });
  });

  it("prevents duplicate threads, cross-account numbers and cross-environment contacts", async () => {
    const create = (accountId: string, externalContactPointId: string) =>
      prisma.communicationThread.create({ data: { accountId, externalContactPointId, businessNumberId: number } });
    await expect(create(acct, point)).rejects.toThrow();
    await expect(create(otherAcct, point)).rejects.toThrow();
    await expect(create(acct, prodPoint)).rejects.toThrow();
    await expect(prisma.communicationThread.update({
      where: { id: thread }, data: { version: 0 },
    })).rejects.toThrow();
    await expect(prisma.communicationThread.update({
      where: { id: thread },
      data: { customerId: key + "-customer", leadId: key + "-lead" },
    })).rejects.toThrow();
  });

  it("tracks private inbound messages and each user's read position without a fake send", async () => {
    await expect(prisma.communicationMessage.create({ data: {
      threadId: thread, accountId: acct, direction: "INBOUND", bodyHash: "a", occurredAt: now,
    } })).rejects.toThrow();
    await prisma.communicationMessage.create({ data: {
      id: incoming, threadId: thread, accountId: acct, direction: "INBOUND",
      providerResourceId: key + "-provider", bodyEncrypted: "encrypted-test-fixture",
      bodyHash: "sha256-test", occurredAt: now,
    } });
    await prisma.communicationReadMarker.create({ data: {
      threadId: thread, userId: user, lastReadMessageId: incoming, lastReadOccurredAt: now,
    } });
    await prisma.communicationReadMarker.create({ data: { threadId: thread, userId: secondUser } });
    await expect(prisma.communicationReadMarker.create({ data: {
      threadId: thread, userId: user,
    } })).rejects.toThrow();
    await expect(prisma.communicationReadMarker.create({ data: {
      threadId: otherThread, userId: user, lastReadMessageId: incoming,
    } })).rejects.toThrow();
  });

  it("requires a real same-account SMS delivery for outbound and deduplicates provider IDs", async () => {
    await prisma.messageDelivery.create({ data: {
      id: delivery, idempotencyKey: key + "-send", channel: "SMS",
      purpose: "TRANSACTIONAL", templateKey: "test", recipientType: "customer",
      recipientAddress: "+13035550003", telecomAccountId: acct, environment: "TEST",
    } });
    await expect(prisma.communicationMessage.create({ data: {
      threadId: thread, accountId: acct, direction: "OUTBOUND", bodyHash: "sha256", occurredAt: now,
    } })).rejects.toThrow();
    await expect(prisma.communicationMessage.create({ data: {
      threadId: thread, accountId: acct, deliveryId: delivery, direction: "INBOUND",
      bodyEncrypted: "encrypted-test", bodyHash: "sha256", occurredAt: now,
    } })).rejects.toThrow();
    await prisma.communicationMessage.create({ data: {
      threadId: thread, accountId: acct, deliveryId: delivery,
      direction: "OUTBOUND", providerResourceId: key + "-sent", bodyHash: "sha256", occurredAt: now,
    } });
    await expect(prisma.communicationMessage.create({ data: {
      threadId: thread, accountId: acct, direction: "INBOUND",
      providerResourceId: key + "-sent", bodyEncrypted: "encrypted-test",
      bodyHash: "sha256", occurredAt: now,
    } })).rejects.toThrow();
    await expect(prisma.communicationMessage.create({ data: {
      threadId: thread, accountId: otherAcct, direction: "INBOUND",
      bodyEncrypted: "encrypted-test", bodyHash: "sha256", occurredAt: now,
    } })).rejects.toThrow();
  });

  it("deduplicates allowlisted contextual links and freezes template revisions", async () => {
    await prisma.communicationLink.create({ data: {
      id: key + "-link", messageId: incoming, entityType: "Lead",
      entityId: key + "-lead", source: "STAFF_CONFIRMED", actorUserId: user,
    } });
    await expect(prisma.communicationLink.create({ data: {
      messageId: incoming, entityType: "Lead", entityId: key + "-lead", source: "EXPLICIT",
    } })).rejects.toThrow();
    const rev1 = await prisma.communicationTemplateRevision.create({ data: {
      key: key + "-reminder", revision: 1, channel: "SMS", purpose: "TRANSACTIONAL",
      body: "Version one", isCurrent: true, createdByUserId: user,
    } });
    await expect(prisma.communicationTemplateRevision.create({ data: {
      key: key + "-reminder", revision: 2, channel: "SMS", purpose: "TRANSACTIONAL",
      body: "Version two", isCurrent: true,
    } })).rejects.toThrow();
    await expect(prisma.communicationTemplateRevision.create({ data: {
      key: key + "-reminder", revision: 2, channel: "EMAIL", purpose: "TRANSACTIONAL",
      body: "Wrong channel",
    } })).rejects.toThrow();
    await expect(prisma.communicationTemplateRevision.create({ data: {
      key: key + "-reminder", revision: 0, channel: "SMS", purpose: "TRANSACTIONAL",
      body: "Invalid zero version",
    } })).rejects.toThrow();
    await expect(prisma.communicationTemplateRevision.update({
      where: { id: rev1.id }, data: { body: "Tampered" },
    })).rejects.toThrow();
    await prisma.communicationTemplateRevision.update({ where: { id: rev1.id }, data: { isCurrent: false } });
    const rev2 = await prisma.communicationTemplateRevision.create({ data: {
      key: key + "-reminder", revision: 2, channel: "SMS", purpose: "TRANSACTIONAL",
      body: "Version two", isCurrent: true,
    } });
    await prisma.messageDelivery.update({ where: { id: delivery }, data: { templateRevisionId: rev1.id } });
    await expect(prisma.messageDelivery.update({
      where: { id: delivery }, data: { templateRevisionId: rev2.id },
    })).rejects.toThrow();
  });

  it("includes every new table in acyclic backup restore order", () => {
    const order = deriveRestoreTableOrder(readFileSync("prisma/schema.prisma", "utf8"), BACKUP_MODEL_POLICY);
    for (const name of [
      "communicationThread", "communicationReadMarker", "communicationMessage",
      "communicationLink", "communicationTemplateRevision",
    ]) expect(BACKUP_TABLES).toContain(name);
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before("telecomAccount", "communicationThread");
    before("businessPhoneNumber", "communicationThread");
    before("contactPoint", "communicationThread");
    before("communicationTemplateRevision", "messageDelivery");
    before("messageDelivery", "communicationMessage");
    before("communicationThread", "communicationMessage");
    before("communicationMessage", "communicationReadMarker");
    before("communicationMessage", "communicationLink");
  });
});
