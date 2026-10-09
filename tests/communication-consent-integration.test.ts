import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { processVerifiedTwilioStop } from "@/domains/messaging/events";
import { projectVerifiedSmsKeyword } from "@/domains/messaging/consent-commands";
import { updateSmsPreference } from "@/domains/portal";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const isolated = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!isolated)("COM-L5B scoped consent (real disposable Postgres)", () => {
  const tag = randomUUID().slice(0, 8);
  const accountSid = "AC" + "d".repeat(32);
  const sid = (hex: string) => "SM" + hex.repeat(32);
  const accountId = "consent-acc-" + tag;
  const numberId = "consent-num-" + tag;
  const userId = "consent-user-" + tag;
  const customerId = "consent-customer-" + tag;
  const sharedCustomerId = "consent-shared-" + tag;
  const sharedUserId = "consent-shared-user-" + tag;
  const address = "+1303555" + String(parseInt(tag.slice(0, 4), 16) % 10000).padStart(4, "0");
  const newAddress = "+1720555" + String(parseInt(tag.slice(4, 8), 16) % 10000).padStart(4, "0");
  const to = "+13035559000";

  beforeAll(async () => {
    await prisma.telecomAccount.create({ data: {
      id: accountId, environment: "PRODUCTION", provider: "twilio",
      externalAccountId: accountSid, status: "READY", label: "consent-test-" + tag,
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: numberId, accountId, address: to, providerNumberId: "provider-" + tag,
      registrationStatus: "APPROVED", verifiedAt: new Date(), capabilities: { sms: true },
    } });
    await prisma.user.create({ data: { id: userId, email: "consent-" + tag + "@example.test", role: "CUSTOMER" } });
    await prisma.customer.create({ data: {
      id: customerId, userId, phone: address, smsOptInAt: new Date(),
      referralCode: "CONSENT" + tag.toUpperCase(),
    } });
    await prisma.user.create({ data: {
      id: sharedUserId, email: "consent-shared-" + tag + "@example.test", role: "CUSTOMER",
    } });
    await prisma.customer.create({ data: {
      id: sharedCustomerId, userId: sharedUserId, phone: address, smsOptInAt: new Date(),
      referralCode: "COS" + tag.toUpperCase(),
    } });
  });
  afterAll(async () => {
    await prisma.consentRecord.deleteMany({ where: { customerId } });
    const points = await prisma.contactPoint.findMany({
      where: { environment: "PRODUCTION", channel: "SMS", address: { in: [address, newAddress] } },
      select: { id: true },
    });
    const pointIds = points.map((p) => p.id);
    await prisma.consentRecord.deleteMany({ where: { contactPointId: { in: pointIds } } });
    await prisma.contactBinding.deleteMany({ where: { contactPointId: { in: pointIds } } });
    await prisma.marketingSuppression.deleteMany({ where: { channel: "SMS", address } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: pointIds } } });
    await prisma.providerEvent.deleteMany({ where: { telecomAccountId: accountId } });
    await prisma.providerEvent.deleteMany({
      where: { provider: "twilio", eventId: { in: [sid("a"), sid("b"), sid("c"), sid("d")] } },
    });
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, sharedCustomerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, sharedUserId] } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
  });

  it("suppresses unresolved numbers and records one REVOKE per purpose despite webhook replay", async () => {
    await processVerifiedTwilioStop({ eventId: sid("a"), from: address, keyword: "STOP" });
    // Two accounts share this address; STOP must suppress the address without
    // picking either account as the supposed sender of the keyword.
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).smsOptInAt).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: sharedCustomerId } })).smsOptInAt).not.toBeNull();
    const input = { accountSid, businessNumberId: numberId, messageSid: sid("a"),
      from: address, text: "STOP", optOutType: "STOP" };
    expect(await projectVerifiedSmsKeyword(input)).toMatchObject({ keyword: "STOP", duplicate: false });
    expect(await projectVerifiedSmsKeyword(input)).toMatchObject({ keyword: "STOP", duplicate: true });
    const point = await prisma.contactPoint.findUniqueOrThrow({
      where: { environment_channel_address: {
        environment: "PRODUCTION", channel: "SMS", address,
      } },
    });
    expect(point.suppressionState).toBe("OPTED_OUT");
    const consent = await prisma.consentRecord.findMany({
      where: { contactPointId: point.id, source: "PROVIDER_KEYWORD", action: "REVOKE" },
    });
    expect(new Set(consent.map((c) => c.purpose))).toEqual(
      new Set(["SMS_TRANSACTIONAL", "SMS_MARKETING", "SMS_CONVERSATIONAL"]),
    );
    expect(consent).toHaveLength(3);
  });

  it("START without provider evidence cannot unblock STOP; confirmed START still grants nothing", async () => {
    await projectVerifiedSmsKeyword({
      accountSid, businessNumberId: numberId, messageSid: sid("b"), from: address, text: "START",
    });
    expect(await prisma.marketingSuppression.findUnique({
      where: { channel_address: { channel: "SMS", address } },
    })).not.toBeNull();
    await projectVerifiedSmsKeyword({
      accountSid, businessNumberId: numberId, messageSid: sid("c"), from: address,
      text: "START", optOutType: "START",
    });
    expect(await prisma.marketingSuppression.findUnique({
      where: { channel_address: { channel: "SMS", address } },
    })).toBeNull();
    const grants = await prisma.consentRecord.count({
      where: { source: "PROVIDER_KEYWORD", action: "GRANT" },
    });
    expect(grants).toBe(0);
    await projectVerifiedSmsKeyword({
      accountSid, businessNumberId: numberId, messageSid: sid("d"), from: address,
      text: "HELP", optOutType: "HELP",
    });
    expect(await prisma.consentRecord.count({
      where: { source: "PROVIDER_KEYWORD", action: "HELP" },
    })).toBeGreaterThanOrEqual(1);
  });

  it("portal preserves transactional disclosure but not marketing; editing the number revokes old phone", async () => {
    await updateSmsPreference(userId, { optedIn: true, phone: address });
    const old = await prisma.contactPoint.findUniqueOrThrow({
      where: { environment_channel_address: {
        environment: "PRODUCTION", channel: "SMS", address,
      } },
    });
    const consent = await prisma.consentRecord.findFirstOrThrow({
      where: { contactPointId: old.id, source: "PORTAL", action: "GRANT" },
      orderBy: { createdAt: "desc" },
    });
    expect(consent.purpose).toBe("SMS_TRANSACTIONAL");
    expect(consent.disclosureVersion).toBeTruthy();
    expect(consent.textHash).toMatch(/^[a-f0-9]{64}$/);
    expect((consent.scope as { businessNumberId?: string | null }).businessNumberId).toBeNull();
    expect(await prisma.consentRecord.count({
      where: { contactPointId: old.id, source: "PORTAL", purpose: "SMS_MARKETING", action: "GRANT" },
    })).toBe(0);
    await updateSmsPreference(userId, { optedIn: true, phone: newAddress });
    const revoked = await prisma.consentRecord.findFirst({
      where: { contactPointId: old.id, source: "PORTAL", purpose: "SMS_TRANSACTIONAL", action: "REVOKE" },
    });
    expect(revoked).not.toBeNull();
    await updateSmsPreference(userId, { optedIn: false, phone: newAddress });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).smsOptInAt).toBeNull();
    const next = await prisma.contactPoint.findUniqueOrThrow({
      where: { environment_channel_address: { environment: "PRODUCTION", channel: "SMS", address: newAddress } },
    });
    expect(await prisma.consentRecord.count({
      where: { contactPointId: next.id, source: "PORTAL", action: "REVOKE" },
    })).toBe(3);
  });
});
