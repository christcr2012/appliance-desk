import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));

import { APPLIANCE_MAINTENANCE_DUE_DAYS } from "@/domains/exceptions/rules";
import { EXCEPTION_CATEGORY_CAP, getExceptionOverview } from "@/domains/exceptions";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

const DAY = 86_400_000;

describe.skipIf(!enabled)("R17 Today exceptions are bounded and ordered in the database", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `r17-user-${tag}`;
  const customerId = `r17-customer-${tag}`;
  const addressId = `r17-address-${tag}`;
  const typeId = `r17-type-${tag}`;
  const jobIds: string[] = [];
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];

  async function appliance(label: string, createdAt: Date, extra: { purchaseDate?: Date } = {}) {
    const id = `r17-${label}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({
      data: { id, assetNumber: `R17${label}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED", createdAt, ...extra },
    });
    return id;
  }

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "R17", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `R17${tag.slice(0, 16)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "17 Cap St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.create({ data: { id: typeId, name: `R17 ${tag}`, slug: `r17-${tag}` } });
  });

  afterAll(async () => {
    await prisma.jobAppliance.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.payment.deleteMany({ where: { invoice: { customerId } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("flags delinquent without a due date, partial payments and overdue OPEN, but not future OPEN or PAID", async () => {
    const yesterday = new Date(Date.now() - DAY);
    const tomorrow = new Date(Date.now() + DAY);
    const failedAt = new Date(Date.now() - 2 * DAY);
    const statuses = [
      { status: "DELINQUENT", dueDate: null, amountPaidCents: 1000 },
      { status: "PARTIALLY_PAID", dueDate: null, amountPaidCents: 2000 },
      { status: "OPEN", dueDate: yesterday, amountPaidCents: 0 },
      { status: "OPEN", dueDate: tomorrow, amountPaidCents: 0 },
      { status: "DELINQUENT", dueDate: tomorrow, amountPaidCents: 0 },
      { status: "PAID", dueDate: yesterday, amountPaidCents: 5000 },
      { status: "VOID", dueDate: yesterday, amountPaidCents: 0 },
    ] as const;
    const ids: string[] = [];
    for (const row of statuses) {
      const invoice = await prisma.invoice.create({
        data: { customerId, status: row.status, dueDate: row.dueDate, amountDueCents: 5000, amountPaidCents: row.amountPaidCents },
      });
      ids.push(invoice.id);
    }
    await prisma.payment.create({
      data: { invoiceId: ids[0], status: "failed", amountCents: 4000, createdAt: failedAt },
    });
    const attention = (await getExceptionOverview()).items.filter((item) => item.category === "PAST_DUE_INVOICE");
    const href = (id: string) => `/desk/billing/customer/${customerId}/invoice/${id}`;
    for (const index of [0, 1, 2, 4]) expect(attention.some((item) => item.href === href(ids[index]))).toBe(true);
    for (const index of [3, 5, 6]) expect(attention.some((item) => item.href === href(ids[index]))).toBe(false);
    const failedItem = attention.find((item) => item.href === href(ids[0]));
    expect(failedItem?.detail).toContain("$40.00");
    expect(failedItem?.since).toEqual(failedAt);
    expect(attention.find((item) => item.href === href(ids[1]))?.detail).toContain("$30.00");
  });

  it("one category never returns more than the cap, reports its true total, and keeps the longest-waiting", async () => {
    const base = Date.now() - 400 * DAY;
    for (let i = 0; i < EXCEPTION_CATEGORY_CAP + 7; i += 1) {
      const job = await prisma.job.create({
        data: { type: "DELIVERY", status: "SCHEDULED", scheduledAt: new Date(base + i * 1000) },
      });
      jobIds.push(job.id);
    }
    const overview = await getExceptionOverview();
    const overdue = overview.items.filter((item) => item.category === "OVERDUE_JOB");
    expect(overdue).toHaveLength(EXCEPTION_CATEGORY_CAP);
    const note = overview.truncated.find((t) => t.category === "OVERDUE_JOB");
    expect(note?.shown).toBe(EXCEPTION_CATEGORY_CAP);
    expect(note!.total).toBeGreaterThanOrEqual(EXCEPTION_CATEGORY_CAP + 7);
    // Longest-waiting first: the 7 newest of our rows are the ones left out.
    const shown = new Set(overdue.map((item) => item.href));
    const newestOurs = jobIds.slice(-7);
    for (const id of newestOurs) expect(shown.has(`/desk/jobs/${id}`)).toBe(false);
    const sinces = overdue.map((item) => item.since.getTime());
    expect(sinces).toEqual([...sinces].sort((a, b) => a - b));
  });

  it("maintenance due: last completed visit wins, else purchase date, else the day it was added", async () => {
    const old = new Date(Date.now() - (APPLIANCE_MAINTENANCE_DUE_DAYS + 200) * DAY);
    const recentVisitUnit = await appliance("a", old);
    const staleVisitUnit = await appliance("b", old);
    const purchasedRecentlyUnit = await appliance("c", old, { purchaseDate: new Date(Date.now() - 10 * DAY) });
    const neverServicedUnit = await appliance("d", old);

    const visit = async (applianceId: string, completedAt: Date) => {
      const job = await prisma.job.create({ data: { type: "MAINTENANCE_VISIT", status: "COMPLETED", completedAt } });
      jobIds.push(job.id);
      await prisma.jobAppliance.create({ data: { jobId: job.id, applianceId } });
    };
    await visit(recentVisitUnit, new Date(Date.now() - 5 * DAY));
    await visit(staleVisitUnit, old);

    const due = (await getExceptionOverview()).items
      .filter((item) => item.category === "APPLIANCE_MAINTENANCE_DUE")
      .map((item) => item.href);
    expect(due).toContain(`/desk/inventory/${staleVisitUnit}`);
    expect(due).toContain(`/desk/inventory/${neverServicedUnit}`);
    expect(due).not.toContain(`/desk/inventory/${recentVisitUnit}`);
    expect(due).not.toContain(`/desk/inventory/${purchasedRecentlyUnit}`);
  });

  it("term ended: own end date, else start plus whole calendar months (month-end clamps), and ended-in-future is excluded", async () => {
    const agreement = async (label: string, startDate: Date, termMonths: number, endDate: Date | null) => {
      const id = `r17-agr-${label}-${tag}`;
      agreementIds.push(id);
      await prisma.rentalAgreement.create({
        data: { id, customerId, serviceAddressId: addressId, status: "ACTIVE", termMonths, startDate, endDate },
      });
      return id;
    };
    const ended = await agreement("ended", new Date(Date.now() - 200 * DAY), 3, null);
    const ownEnd = await agreement("ownend", new Date(Date.now() - 20 * DAY), 12, new Date(Date.now() - 2 * DAY));
    const running = await agreement("running", new Date(Date.now() - 20 * DAY), 12, null);
    const runningOwnEnd = await agreement("runend", new Date(Date.now() - 400 * DAY), 3, new Date(Date.now() + 30 * DAY));
    const jan31 = await agreement("jan31", new Date("2020-01-31T12:00:00Z"), 1, null);

    const overview = await getExceptionOverview();
    const hrefs = overview.items.filter((i) => i.category === "AGREEMENT_TERM_EXPIRED").map((i) => i.href);
    expect(hrefs).toContain(`/desk/agreements/${ended}`);
    expect(hrefs).toContain(`/desk/agreements/${ownEnd}`);
    expect(hrefs).not.toContain(`/desk/agreements/${running}`);
    expect(hrefs).not.toContain(`/desk/agreements/${runningOwnEnd}`);
    const clamped = overview.items.find((i) => i.href === `/desk/agreements/${jan31}`);
    expect(clamped?.since.toISOString().slice(0, 10)).toBe("2020-02-29");
  });
});
