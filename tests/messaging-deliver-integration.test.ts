import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  customerEmail: vi.fn(),
  sms: vi.fn(),
  smsState: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mocks.email(...args),
}));
vi.mock("@/lib/customer-email", () => ({
  sendCustomerEmail: (...args: unknown[]) => mocks.customerEmail(...args),
}));
vi.mock("@/lib/sms", () => ({
  sendSms: (...args: unknown[]) => mocks.sms(...args),
  getSmsProviderState: (...args: unknown[]) => mocks.smsState(...args),
}));

import {
  deliverMessage,
  reconcileUnknownDeliveries,
} from "@/domains/messaging/deliver";
import { prisma } from "@/lib/prisma";

const target = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("message delivery ledger (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const prefix = `msg-${tag}`;
  const addresses: string[] = [];
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;

  const input = (key: string, address = `${tag}@example.test`) => ({
    idempotencyKey: `${prefix}-${key}`,
    channel: "EMAIL" as const,
    purpose: "TRANSACTIONAL" as const,
    templateKey: "test-message",
    customerFacing: true,
    recipient: {
      type: "Customer",
      id: `customer-${tag}`,
      address,
    },
    subject: { type: "Customer", id: `customer-${tag}` },
    render: () => ({ subject: "Test", text: "Test message" }),
  });

  beforeEach(() => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    mocks.email.mockReset().mockResolvedValue({
      sent: true,
      outcome: "SENT",
      providerMessageId: `staff-${tag}`,
    });
    mocks.customerEmail.mockReset().mockResolvedValue({
      sent: true,
      outcome: "SENT",
      providerMessageId: `customer-${randomUUID()}`,
    });
    mocks.sms.mockReset().mockResolvedValue({
      sent: true,
      outcome: "SENT",
      providerMessageId: `SM${tag.slice(0, 30)}`,
    });
    mocks.smsState.mockReset().mockResolvedValue("UNKNOWN");
  });

  afterAll(async () => {
    process.env.VERCEL = originalVercel;
    process.env.VERCEL_ENV = originalVercelEnv;
    await prisma.messageDelivery.deleteMany({
      where: { idempotencyKey: { startsWith: prefix } },
    });
    if (addresses.length) {
      await prisma.marketingSuppression.deleteMany({
        where: { address: { in: addresses } },
      });
    }
  });

  it("uses the business key to make a duplicate invocation one provider call", async () => {
    const first = await deliverMessage(input("once"));
    const second = await deliverMessage(input("once"));
    expect(first.state).toBe("ACCEPTED");
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(mocks.customerEmail).toHaveBeenCalledTimes(1);
  });

  it("lets exactly one concurrent invocation own a new business key", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    mocks.customerEmail.mockImplementationOnce(async () => {
      await providerGate;
      return {
        sent: true,
        outcome: "SENT",
        providerMessageId: `concurrent-${tag}`,
      };
    });

    const first = deliverMessage(input("concurrent"));
    const second = deliverMessage(input("concurrent"));

    // Give both transactions a chance to contend for the unique business key
    // while the winning provider call is still blocked.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.customerEmail).toHaveBeenCalledTimes(1);
    releaseProvider();

    const [a, b] = await Promise.all([first, second]);
    expect(a.deliveryId).toBe(b.deliveryId);
    expect(mocks.customerEmail).toHaveBeenCalledTimes(1);
    expect([a.state, b.state]).toContain("ACCEPTED");
  });

  it("suppresses marketing before calling a provider", async () => {
    const address = `SUPPRESSED-${tag}@Example.test`;
    addresses.push(address.toLowerCase());
    await prisma.marketingSuppression.create({
      data: {
        channel: "EMAIL",
        address: address.toLowerCase(),
        reason: "unsubscribe",
        source: "test",
      },
    });
    const result = await deliverMessage({
      ...input("suppressed", address),
      purpose: "MARKETING",
    });
    expect(result.state).toBe("SUPPRESSED");
    expect(mocks.customerEmail).not.toHaveBeenCalled();
  });

  it("records a clear provider refusal as FAILED", async () => {
    mocks.customerEmail.mockResolvedValue({
      sent: false,
      outcome: "REJECTED",
    });
    const result = await deliverMessage(input("rejected"));
    expect(result.state).toBe("FAILED");
    const row = await prisma.messageDelivery.findUniqueOrThrow({
      where: { id: result.deliveryId },
    });
    expect(row.lastError).toBe("provider rejected message");
  });

  it("retries an unknown outcome exactly once, then never blindly retries the UNKNOWN row", async () => {
    mocks.customerEmail.mockResolvedValue({
      sent: false,
      outcome: "UNKNOWN",
    });
    const first = await deliverMessage(input("unknown"));
    const second = await deliverMessage(input("unknown"));
    expect(first.state).toBe("UNKNOWN");
    expect(second.state).toBe("UNKNOWN");
    expect(mocks.customerEmail).toHaveBeenCalledTimes(2);
    const row = await prisma.messageDelivery.findUniqueOrThrow({
      where: { id: first.deliveryId },
    });
    expect(row.attempts).toBe(2);
  });

  it("does not create a PENDING delivery when rendering fails before provider invocation", async () => {
    const key = "render-failure-new";
    const failing = {
      ...input(key),
      render: () => {
        throw new Error("render failed");
      },
    };

    await expect(deliverMessage(failing)).rejects.toThrow("render failed");
    expect(
      await prisma.messageDelivery.findUnique({
        where: { idempotencyKey: `${prefix}-${key}` },
      }),
    ).toBeNull();
    expect(mocks.customerEmail).not.toHaveBeenCalled();

    const retry = await deliverMessage(input(key));
    expect(retry.state).toBe("ACCEPTED");
    expect(mocks.customerEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing retryable delivery retryable until pre-send rendering succeeds", async () => {
    const key = `${prefix}-render-failure-retryable`;
    const existing = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: key,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "test-message",
        recipientType: "Customer",
        recipientId: `customer-${tag}`,
        recipientAddress: `${tag}@example.test`,
        subjectType: "Customer",
        subjectId: `customer-${tag}`,
        state: "NOT_SENT",
        lastError: "previous safe failure",
      },
    });

    await expect(
      deliverMessage({
        ...input("unused"),
        idempotencyKey: key,
        render: () => {
          throw new Error("render failed");
        },
      }),
    ).rejects.toThrow("render failed");

    const afterFailure = await prisma.messageDelivery.findUniqueOrThrow({
      where: { id: existing.id },
    });
    expect(afterFailure.state).toBe("NOT_SENT");
    expect(afterFailure.attempts).toBe(existing.attempts);
    expect(mocks.customerEmail).not.toHaveBeenCalled();

    const retry = await deliverMessage({
      ...input("unused"),
      idempotencyKey: key,
    });
    expect(retry.state).toBe("ACCEPTED");
    expect(mocks.customerEmail).toHaveBeenCalledTimes(1);
  });

  it("records previews as NOT_SENT without rendering or calling a provider", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    const render = vi.fn(() => ({
      subject: "private",
      text: "private",
    }));
    const result = await deliverMessage({ ...input("preview"), render });
    expect(result.state).toBe("NOT_SENT");
    expect(render).not.toHaveBeenCalled();
    expect(mocks.customerEmail).not.toHaveBeenCalled();
    const row = await prisma.messageDelivery.findUniqueOrThrow({
      where: { id: result.deliveryId },
    });
    expect(row.lastError).toBe("previews never send");
  });

  it("fails transactional email locally when a hard bounce is already on file", async () => {
    const address = `BOUNCE-${tag}@Example.test`;
    addresses.push(address.toLowerCase());
    await prisma.marketingSuppression.create({
      data: {
        channel: "EMAIL",
        address: address.toLowerCase(),
        reason: "bounce",
        source: "test",
      },
    });
    const result = await deliverMessage(input("hard-bounce", address));
    expect(result.state).toBe("FAILED");
    expect(mocks.customerEmail).not.toHaveBeenCalled();
    const row = await prisma.messageDelivery.findUniqueOrThrow({
      where: { id: result.deliveryId },
    });
    expect(row.lastError).toBe("hard bounce on file");
  });

  it("reconciles an UNKNOWN SMS when the provider later reports delivery", async () => {
    const row = await prisma.messageDelivery.create({
      data: {
        idempotencyKey: `${prefix}-reconcile-sms`,
        channel: "SMS",
        purpose: "TRANSACTIONAL",
        templateKey: "job-reminder",
        recipientType: "Customer",
        recipientAddress: "+13035550100",
        state: "UNKNOWN",
        providerMessageId: `SM${tag.slice(0, 30)}`,
      },
    });
    mocks.smsState.mockResolvedValue("DELIVERED");
    expect(await reconcileUnknownDeliveries()).toEqual({ resolved: 1 });
    expect(
      (
        await prisma.messageDelivery.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).state,
    ).toBe("DELIVERED");
  });
});
