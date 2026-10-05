import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { annualReminderKey, queueAnnualReminders } from "@/domains/notices/annual-reminder";
import { noticeProblemException } from "@/domains/exceptions/rules";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("yearly reminders for month-to-month rentals", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `ann-user-${tag}`;
  const customerId = `ann-customer-${tag}`;
  const addressId = `ann-address-${tag}`;
  const ids: string[] = [];
  const version = 8000 + Math.floor(Math.random() * 900);

  async function agreement(data: {
    termMonths?: number | null;
    status?: "ACTIVE" | "ENDED";
    root?: string | null;
    since: Date;
    endDate?: Date | null;
    renewedFrom?: string | null;
  }) {
    const created = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: data.status ?? "ACTIVE",
        termMonths: data.termMonths ?? null,
        startDate: data.since,
        endDate: data.endDate ?? null,
        firstDeliveredOn: data.since,
        nextBillingDate: new Date("2027-03-08T07:00:00Z"),
        continuousSince: data.since,
        monthToMonthTermsVersion: version,
        renewedFromAgreementId: data.renewedFrom ?? null,
        lines: { create: [{ label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 }] },
      },
    });
    const root = data.root === undefined ? created.id : data.root;
    await prisma.rentalAgreement.update({ where: { id: created.id }, data: { continuityRootId: root ?? created.id } });
    ids.push(created.id);
    return { ...created, continuityRootId: root ?? created.id };
  }
  const noticeFor = (root: string, k: number) => prisma.customerNotice.findUnique({ where: { dedupeKey: annualReminderKey(root, k) } });

  beforeAll(async () => {
    await prisma.monthToMonthTermsVersion.create({ data: { version, noticeDays: 30, termsText: "Annual test terms." } });
    await prisma.user.create({ data: { id: userId, email: `${tag}-c@example.test`, name: "Annual Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `N${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
  });

  afterAll(async () => {
    await prisma.customerNotice.deleteMany({ where: { customerId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.updateMany({ where: { id: { in: ids } }, data: { renewedFromAgreementId: null } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.monthToMonthTermsVersion.deleteMany({ where: { version } });
  });

  it("annual-monthly-from-the-outset: queued once the first anniversary is 40 days away, and never twice", async () => {
    const a = await agreement({ since: new Date("2027-02-08T07:00:00Z") });
    // First anniversary: 2028-02-08. 41 days before: nothing yet.
    await queueAnnualReminders(new Date("2027-12-28T18:00:00Z"));
    expect(await noticeFor(a.continuityRootId, 1)).toBeNull();
    // 38 days before: queued with the 25 to 40 day window.
    const first = await queueAnnualReminders(new Date("2028-01-01T18:00:00Z"));
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const notice = await noticeFor(a.continuityRootId, 1);
    expect(notice?.kind).toBe("ANNUAL_REMINDER");
    expect(notice?.status).toBe("PENDING");
    expect(notice?.agreementId).toBe(a.id);
    expect(notice?.earliestAt?.toISOString()).toBe("2027-12-30T07:00:00.000Z");
    await queueAnnualReminders(new Date("2028-01-02T18:00:00Z"));
    expect(await prisma.customerNotice.count({ where: { agreementId: a.id, kind: "ANNUAL_REMINDER" } })).toBe(1);
  });

  it("annual-twelve-month-to-monthly: month 13 is covered by the delivered fixed-term reminder; month 25 gets its own", async () => {
    const fixed = await agreement({
      termMonths: 12,
      status: "ENDED",
      since: new Date("2027-04-10T07:00:00Z"),
      endDate: new Date("2028-04-10T05:59:59Z"),
    });
    const monthly = await agreement({ since: new Date("2027-04-10T07:00:00Z"), root: fixed.id, renewedFrom: fixed.id });
    await prisma.customerNotice.create({
      data: {
        customerId,
        agreementId: fixed.id,
        kind: "RENEWAL_REMINDER",
        dedupeKey: `renewal-reminder-${fixed.id}-2028-04-09`,
        subject: "s",
        body: "b",
        status: "SENT",
        sentAt: new Date("2028-03-10T18:00:00Z"),
      },
    });
    // 2028-04-10 is month 13: already covered, nothing queued even inside the window.
    await queueAnnualReminders(new Date("2028-03-10T18:00:00Z"));
    expect(await noticeFor(fixed.id, 1)).toBeNull();
    // 2029-04-10 is month 25: its own reminder, counted from the first delivery.
    await queueAnnualReminders(new Date("2029-03-10T18:00:00Z"));
    const second = await noticeFor(fixed.id, 2);
    expect(second?.agreementId).toBe(monthly.id);
  });

  it("annual-six-month-to-monthly-through-month-13 and a replacement agreement does not reset the count", async () => {
    const six = await agreement({ termMonths: 6, status: "ENDED", since: new Date("2027-05-10T06:00:00Z"), endDate: new Date("2027-11-09T06:59:59Z") });
    const monthly = await agreement({ since: new Date("2027-05-10T06:00:00Z"), root: six.id, renewedFrom: six.id });
    // A replacement agreement that keeps the same continuity root and start.
    const replacement = await agreement({ since: new Date("2027-05-10T06:00:00Z"), root: six.id });
    await prisma.rentalAgreement.update({ where: { id: monthly.id }, data: { status: "ENDED" } });
    await queueAnnualReminders(new Date("2028-04-05T18:00:00Z"));
    const notice = await noticeFor(six.id, 1);
    expect(notice?.agreementId).toBe(replacement.id);
    expect(notice?.status).toBe("PENDING");
  });

  it("annual-missed-is-high-on-today-and-billing-continues", async () => {
    const a = await agreement({ since: new Date("2027-06-10T06:00:00Z") });
    // The first anniversary 2028-06-10 is only 15 days away: too late to send.
    const run = await queueAnnualReminders(new Date("2028-05-26T18:00:00Z"));
    expect(run.missed).toBeGreaterThanOrEqual(1);
    const notice = await noticeFor(a.continuityRootId, 1);
    expect(notice?.status).toBe("MISSED");
    expect(noticeProblemException("MISSED", { id: notice!.id, customerName: "X", createdAt: notice!.createdAt, kind: notice!.kind }).severity).toBe("high");
    // Billing is untouched.
    const after = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.terminationRequestedAt).toBeNull();
  });
});
