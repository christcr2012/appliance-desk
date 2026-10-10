import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  processVerifiedResendEvent,
  processVerifiedTwilioStatusEvent,
  processVerifiedTwilioStop,
  replayUnmatchedTwilioStatusEvents,
} from "@/domains/messaging/events";
import { prisma } from "@/lib/prisma";
import { applyDeliveryObservationInTx } from "@/domains/messaging/delivery-state";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("provider message events (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `event-user-${tag}`;
  const customerId = `event-customer-${tag}`;
  const email = `${tag}@example.test`;
  const phone = `+1303${tag.replace(/\D/g, "").padEnd(7, "5").slice(0, 7)}`;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email, role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `EV${tag.slice(0, 16)}`,
        phone,
        smsOptInAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.providerEvent.deleteMany({ where: { eventId: { contains: tag } } });
    await prisma.marketingSuppression.deleteMany({ where: { OR: [{ address: email }, { address: phone }] } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { startsWith: `event-${tag}` } } });
    await prisma.customerNotice.deleteMany({ where: { dedupeKey: { startsWith: `event-${tag}` } } });
    await prisma.consentRecord.deleteMany({ where: { customerId, kind: "sms_opt_out" } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("retains an early verified Twilio receipt until the sender saves its SID", async () => {
    const sid = `SM${tag.slice(0,28)}a1`;
    const eventId = `early-${tag}`;
    const early = await processVerifiedTwilioStatusEvent({
      eventId, messageSid: sid, status: "delivered",
    });
    expect(early).toEqual({ duplicate: false, matched: false });
    const before = await prisma.providerEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: "twilio", eventId } },
    });
    expect(before.processedAt).toBeNull();
    expect(before.summary).toMatchObject({ matchState: "unmatched" });
    const delivery = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `event-${tag}-early`, channel: "SMS",
        purpose: "TRANSACTIONAL", templateKey: "test",
        recipientType: "Customer", recipientId: customerId,
        recipientAddress: phone, state: "UNKNOWN", providerMessageId: sid,
      },
    });
    const [first, second] = await Promise.all([
      replayUnmatchedTwilioStatusEvents(50),
      replayUnmatchedTwilioStatusEvents(50),
    ]);
    expect(first.matched + second.matched).toBe(1);
    expect((await prisma.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).state)
      .toBe("DELIVERED");
    expect((await prisma.providerEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: "twilio", eventId } },
    })).processedAt).not.toBeNull();
    expect((await replayUnmatchedTwilioStatusEvents(50)).matched).toBe(0);
  });

  it("late sender acceptance cannot downgrade delivered callback evidence", async () => {
    const sid = `SM${tag.slice(0,28)}b2`;
    const delivery = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `event-${tag}-late`, channel: "SMS",
        purpose: "TRANSACTIONAL", templateKey: "test",
        recipientType: "Customer", recipientId: customerId,
        recipientAddress: phone, state: "PENDING", providerMessageId: sid,
      },
    });
    await processVerifiedTwilioStatusEvent({
      eventId: `delivered-before-sender-${tag}`, messageSid: sid, status: "delivered",
    });
    const updated = await prisma.$transaction(tx => applyDeliveryObservationInTx(tx, {
      deliveryId: delivery.id, state: "ACCEPTED", observedAt: new Date(),
    }));
    expect(updated.state).toBe("DELIVERED");
    expect(updated.deliveredAt).not.toBeNull();
  });

  it("concurrent accepted and delivered callbacks preserve the strongest evidence", async () => {
    const sid = `SM${tag.slice(0,28)}d4`;
    const delivery = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `event-${tag}-concurrent`, channel: "SMS",
        purpose: "TRANSACTIONAL", templateKey: "test",
        recipientType: "Customer", recipientId: customerId,
        recipientAddress: phone, state: "PENDING", providerMessageId: sid,
      },
    });
    const events = await Promise.all([
      processVerifiedTwilioStatusEvent({
        eventId: `concurrent-accepted-${tag}`, messageSid: sid, status: "sent",
      }),
      processVerifiedTwilioStatusEvent({
        eventId: `concurrent-delivered-${tag}`, messageSid: sid, status: "delivered",
      }),
    ]);
    expect(events.every(result => result.matched)).toBe(true);
    expect((await prisma.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).state)
      .toBe("DELIVERED");
    const replayed = await processVerifiedTwilioStatusEvent({
      eventId: `concurrent-delivered-${tag}`, messageSid: sid, status: "delivered",
    });
    expect(replayed.duplicate).toBe(true);
  });

  it("invalid Twilio status is explicitly ignored rather than pending forever", async () => {
    const eventId = `invalid-status-${tag}`;
    const result = await processVerifiedTwilioStatusEvent({
      eventId, messageSid: `SM${tag.slice(0,28)}c3`, status: "not_a_status",
    });
    expect(result.matched).toBe(false);
    const stored = await prisma.providerEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: "twilio", eventId } },
    });
    expect(stored.processedAt).not.toBeNull();
  });

  it("does not downgrade DELIVERED when a late sent event arrives", async () => {
    const providerMessageId = `resend-delivered-${tag}`;
    const delivery = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `event-${tag}-ordering`,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "test",
        recipientType: "Customer",
        recipientId: customerId,
        recipientAddress: email,
        state: "ACCEPTED",
        providerMessageId,
      },
    });
    await processVerifiedResendEvent(`delivered-${tag}`, {
      type: "email.delivered",
      data: { email_id: providerMessageId, to: [email] },
    });
    await processVerifiedResendEvent(`sent-${tag}`, {
      type: "email.sent",
      data: { email_id: providerMessageId, to: [email] },
    });
    expect((await prisma.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).state).toBe("DELIVERED");
  });

  it("treats an event replay as a no-op", async () => {
    const providerMessageId = `resend-replay-${tag}`;
    await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `event-${tag}-replay`,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "test",
        recipientType: "Customer",
        recipientId: customerId,
        recipientAddress: email,
        state: "ACCEPTED",
        providerMessageId,
      },
    });
    const event = { type: "email.delivered", data: { email_id: providerMessageId, to: [email] } };
    expect((await processVerifiedResendEvent(`replay-${tag}`, event)).duplicate).toBe(false);
    expect((await processVerifiedResendEvent(`replay-${tag}`, event)).duplicate).toBe(true);
    expect(await prisma.providerEvent.count({ where: { provider: "resend", eventId: `replay-${tag}` } })).toBe(1);
  });

  it("stores a verified event for an unknown provider message id without inventing delivery state", async () => {
    const eventId = `unknown-${tag}`;
    const result = await processVerifiedResendEvent(eventId, {
      type: "email.delivered",
      data: { email_id: `missing-${tag}`, to: [email] },
    });
    expect(result).toEqual({ duplicate: false, matched: false });
    expect(await prisma.providerEvent.findUnique({
      where: { provider_eventId: { provider: "resend", eventId } },
    })).toMatchObject({ provider: "resend", eventId, type: "email.delivered" });
    expect(await prisma.messageDelivery.count({
      where: { providerMessageId: `missing-${tag}` },
    })).toBe(0);
  });

  it("hard bounce creates suppression and returns a linked legal notice to human review", async () => {
    const providerMessageId = `resend-bounce-${tag}`;
    const delivery = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `event-${tag}-bounce`,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "customer-notice",
        recipientType: "Customer",
        recipientId: customerId,
        recipientAddress: email,
        subjectType: "CustomerNotice",
        subjectId: `notice-${tag}`,
        state: "ACCEPTED",
        providerMessageId,
      },
    });
    const notice = await prisma.customerNotice.create({
      data: {
        customerId,
        kind: "ANNUAL_REMINDER",
        dedupeKey: `event-${tag}-notice`,
        subject: "Notice",
        body: "Body",
        status: "SENT",
        providerMessageId,
        acceptedAt: new Date(),
        evidenceDate: new Date(),
      },
    });

    await processVerifiedResendEvent(`bounce-${tag}`, {
      type: "email.bounced",
      data: { email_id: providerMessageId, to: [email], bounce: { type: "hard" } },
    });

    expect((await prisma.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).state).toBe("BOUNCED");
    expect(await prisma.marketingSuppression.findUnique({
      where: { channel_address: { channel: "EMAIL", address: email } },
    })).toMatchObject({ reason: "bounce" });
    expect((await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } })).status).toBe("UNCERTAIN");
  });

  it("STOP matches a legacy formatted phone, changes consent, writes evidence and suppresses canonical SMS", async () => {
    const ten = phone.slice(2);
    const formatted = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
    await prisma.customer.update({
      where: { id: customerId },
      data: { phone: formatted, smsOptInAt: new Date() },
    });

    const result = await processVerifiedTwilioStop({
      eventId: `stop-${tag}`,
      from: phone,
      keyword: "STOP",
    });
    expect(result.customerId).toBe(customerId);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.phone).toBe(formatted);
    expect(customer.smsOptInAt).toBeNull();
    const consent = await prisma.consentRecord.findFirstOrThrow({
      where: { customerId, kind: "sms_opt_out" },
      orderBy: { createdAt: "desc" },
    });
    expect(consent.details).toMatchObject({ source: "twilio_stop", phone });
    expect(await prisma.marketingSuppression.findUnique({
      where: { channel_address: { channel: "SMS", address: phone } },
    })).toMatchObject({ reason: "stop" });
    expect((await processVerifiedTwilioStop({ eventId: `stop-${tag}`, from: phone, keyword: "STOP" })).duplicate).toBe(true);
    expect(await prisma.consentRecord.count({ where: { customerId, kind: "sms_opt_out" } })).toBe(1);
  });

  it("applies Twilio delivery state without allowing a later sent callback to downgrade it", async () => {
    const sid = `SM${tag.slice(0, 28)}e5`;
    const delivery = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `event-${tag}-twilio`,
        channel: "SMS",
        purpose: "TRANSACTIONAL",
        templateKey: "job-day-reminder",
        recipientType: "Customer",
        recipientId: customerId,
        recipientAddress: phone,
        state: "ACCEPTED",
        providerMessageId: sid,
      },
    });
    await processVerifiedTwilioStatusEvent({
      eventId: `${sid}:delivered-${tag}`,
      messageSid: sid,
      status: "delivered",
    });
    await processVerifiedTwilioStatusEvent({
      eventId: `${sid}:sent-${tag}`,
      messageSid: sid,
      status: "sent",
    });
    expect((await prisma.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).state).toBe("DELIVERED");
  });
});
