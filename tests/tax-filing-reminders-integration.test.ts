import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn(async () => ({ sent: true, outcome: "SENT" as const, providerMessageId: "owner-notice-test" })),
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.email }));
vi.mock("@/lib/customer-email", () => ({
  sendCustomerEmail: vi.fn(async () => { throw new Error("Owner alerts must never use customer transport"); }),
}));
vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async () => { throw new Error("Owner alerts cannot send SMS"); }),
  getSmsProviderState: vi.fn(async () => "UNKNOWN"),
}));

import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { __setFilingAmendmentDetectorForTests, licenseReminderStage, overdueReminderDue, runTaxFilingCalendar } from "@/domains/tax/filing-reminders";
import { sendOwnerAlert } from "@/domains/messaging/owner-alerts";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
const day = (value: string): Date => businessDateFromKey(value)!;

describe.skipIf(!enabled)("T-6a2 owner filing reminders (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const prefix = `filing-${tag}`;
  const ownerIds = [`${prefix}-owner1`, `${prefix}-owner2`];
  const initialVercel = process.env.VERCEL;
  const initialEnvironment = process.env.VERCEL_ENV;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: ownerIds.map((id, n) => ({
        id, role: "OWNER" as const, email: `${id}@example.test`, emailVerified: true,
        name: `Filing Owner ${n}`,
      })),
    });
  });

  async function account(name: string, input: {
    firstPeriodStart?: Date | null;
    dueDayOfFollowingMonth?: number;
    emailReminders?: boolean;
    licenseExpiresOn?: Date | null;
  } = {}) {
    return prisma.taxFilingAccount.create({
      data: {
        id: `${prefix}-${name}`, name,
        firstPeriodStart: input.firstPeriodStart ?? null,
        dueDayOfFollowingMonth: input.dueDayOfFollowingMonth ?? 20,
        emailReminders: input.emailReminders ?? true,
        licenseExpiresOn: input.licenseExpiresOn ?? null,
      },
    });
  }
  afterEach(async () => {
    __setFilingAmendmentDetectorForTests(null);
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    await prisma.messageDelivery.deleteMany({
      where: { OR: [
        { idempotencyKey: { startsWith: `tax-reminder:${prefix}` } },
        { idempotencyKey: { startsWith: `tax-license:${prefix}` } },
        { idempotencyKey: { startsWith: `owner-test:${prefix}` } },
      ] },
    });
    await prisma.taxFilingAmendment.deleteMany({ where: { period: { filingAccountId: { startsWith: prefix } } } });
    await prisma.taxFilingPeriod.deleteMany({ where: { filingAccountId: { startsWith: prefix } } });
    await prisma.taxFilingAccount.deleteMany({ where: { id: { startsWith: prefix } } });
    mocks.email.mockClear();
  });
  afterAll(async () => {
    if (initialVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = initialVercel;
    if (initialEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = initialEnvironment;
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
  });

  it("writes one period per key, suppresses replay, sends a durable alert to EACH active owner", async () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const file = await account("repeat", { firstPeriodStart: day("2026-09-01") });
    const now = day("2026-10-01");
    const first = await runTaxFilingCalendar(now);
    const again = await runTaxFilingCalendar(now);
    expect(first.periodsCreated).toBe(2);
    expect(again.periodsCreated).toBe(0);
    const periods = await prisma.taxFilingPeriod.findMany({ where: { filingAccountId: file.id }, orderBy: { periodStart: "asc" } });
    expect(periods).toHaveLength(2);
    const key = `tax-reminder:${periods[0]!.id}:READY`;
    const sent = await prisma.messageDelivery.findMany({ where: { idempotencyKey: { startsWith: key } } });
    for (const id of ownerIds) {
      expect(sent.some(row => row.idempotencyKey === `${key}:owner:${id}`)).toBe(true);
    }
    expect(sent.filter(row => ownerIds.some(id => row.idempotencyKey.endsWith(`:owner:${id}`)))).toHaveLength(2);
    expect(sent.every(row => row.channel === "EMAIL" && row.purpose === "TRANSACTIONAL")).toBe(true);
  });

  it("honors email switch off while still creating periods and never sending in preview", async () => {
    await account("off", { firstPeriodStart: day("2026-09-01"), emailReminders: false });
    expect((await runTaxFilingCalendar(day("2026-10-01"))).periodsCreated).toBe(2);
    expect(await prisma.messageDelivery.count({ where: { idempotencyKey: { startsWith: "tax-reminder:" } } })).toBeGreaterThanOrEqual(0);

    await account("preview", { firstPeriodStart: day("2026-09-01") });
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    mocks.email.mockClear();
    await runTaxFilingCalendar(day("2026-10-01"));
    expect(mocks.email).not.toHaveBeenCalled();
    const deliveries = await prisma.messageDelivery.findMany({
      where: { idempotencyKey: { contains: "READY:owner:" } },
    });
    expect(deliveries.some(row => row.state === "NOT_SENT")).toBe(true);
  });

  it("never sends a pre-start reminder, handles legal due dates and repeats overdue every third day", async () => {
    await account("late", { firstPeriodStart: day("2026-05-01"), dueDayOfFollowingMonth: 20 });
    expect(overdueReminderDue(day("2026-06-22"), day("2026-06-22"))).toBe(false);
    expect(overdueReminderDue(day("2026-06-22"), day("2026-06-23"))).toBe(true);
    expect(overdueReminderDue(day("2026-06-22"), day("2026-06-25"))).toBe(false);
    expect(overdueReminderDue(day("2026-06-22"), day("2026-06-26"))).toBe(true);
    expect(licenseReminderStage(day("2026-11-01"), day("2026-09-02"))).toBe("DUE_IN_60");
    expect(licenseReminderStage(day("2026-11-01"), day("2026-11-02"))).toBe("OVERDUE_2026-11-02");
    const result = await runTaxFilingCalendar(day("2026-04-01"));
    expect(result.periodsCreated).toBe(0);
  });

  it("does not lose the calendar run when the amendment detector is installed", async () => {
    __setFilingAmendmentDetectorForTests(async () => 4);
    expect((await runTaxFilingCalendar(day("2026-10-01"))).amendmentsDetected).toBe(4);
  });

  it("does not use public business contacts for internal alerts", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    await sendOwnerAlert({
      key: `owner-test:${prefix}`,
      subject: "Owner only",
      text: "No customer data",
      href: "/desk/today",
    });
    const recipients = await prisma.messageDelivery.findMany({
      where: { idempotencyKey: { startsWith: `owner-test:${prefix}` } },
    });
    for (const id of ownerIds) {
      expect(recipients.find(x => x.recipientId === id)?.state).toBe("NOT_SENT");
    }
  });
});
