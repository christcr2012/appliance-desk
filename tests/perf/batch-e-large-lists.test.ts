import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "perf-owner", role: "OWNER" } }),
}));

import { prisma } from "@/lib/prisma";
import { getCustomersPage } from "@/domains/customers";
import { getJobsPage } from "@/domains/jobs";
import { getChurnRiskCustomers, getWinBackLeads } from "@/domains/growth";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  process.env.BATCH_E_PERF === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";

const CUSTOMER_COUNT = 1_000;
const INVOICE_COUNT = 2_000;
const JOB_COUNT = 500;
const LEAD_COUNT = 1_000;
const PAGE_SIZE = 50;

async function measured<T>(label: string, fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  const ms = performance.now() - start;
  console.log(`[batch-e-perf] ${label}: ${ms.toFixed(1)}ms`);
  return { value, ms };
}

describe.skipIf(!enabled)("Batch E large-list baseline (isolated CI Postgres)", () => {
  const tag = `perf-${randomUUID().replaceAll("-", "")}`;
  const customerId = (index: number) => `${tag}-customer-${index}`;
  const userId = (index: number) => `${tag}-user-${index}`;

  beforeAll(async () => {
    const old = new Date("2025-01-01T12:00:00Z");
    await prisma.user.createMany({
      data: Array.from({ length: CUSTOMER_COUNT }, (_, index) => ({
        id: userId(index),
        email: `${tag}-${index}@example.test`,
        name: `Perf Customer ${index}`,
        role: "CUSTOMER" as const,
        emailVerified: true,
      })),
    });
    await prisma.customer.createMany({
      data: Array.from({ length: CUSTOMER_COUNT }, (_, index) => ({
        id: customerId(index),
        userId: userId(index),
        referralCode: `P${tag.slice(-10)}${index.toString(36)}`,
      })),
    });
    await prisma.invoice.createMany({
      data: Array.from({ length: INVOICE_COUNT }, (_, index) => ({
        id: `${tag}-invoice-${index}`,
        customerId: customerId(index % CUSTOMER_COUNT),
        status: "OPEN" as const,
        amountDueCents: 6_000,
        amountPaidCents: 0,
        dueDate: old,
      })),
    });
    await prisma.job.createMany({
      data: Array.from({ length: JOB_COUNT }, (_, index) => ({
        id: `${tag}-job-${index}`,
        type: "DELIVERY" as const,
        status: "SCHEDULED" as const,
        scheduledAt: new Date(old.getTime() + index * 60_000),
      })),
    });
    await prisma.lead.createMany({
      data: Array.from({ length: LEAD_COUNT }, (_, index) => ({
        id: `${tag}-lead-${index}`,
        status: index % 2 === 0 ? ("NEW" as const) : ("CONTACTED" as const),
        contactName: `Perf Lead ${index}`,
        phone: `97055${(10000 + index).toString().slice(-5)}`,
        createdAt: old,
        lastRealContactAt: old,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { startsWith: `${tag}-invoice-` } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: `${tag}-job-` } } });
    await prisma.lead.deleteMany({ where: { id: { startsWith: `${tag}-lead-` } } });
    await prisma.customer.deleteMany({ where: { id: { startsWith: `${tag}-customer-` } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: `${tag}-user-` } } });
  }, 30_000);

  it("keeps customer, job and growth lists bounded and records wall time", async () => {
    const asOf = new Date("2026-10-05T18:00:00Z");
    const customers = await measured("customers page / 1000 customers", () =>
      getCustomersPage(0, PAGE_SIZE),
    );
    const jobs = await measured("jobs page / 500 jobs", () =>
      getJobsPage(undefined, 0, PAGE_SIZE),
    );
    const winBack = await measured("win-back / 1000 leads", () =>
      getWinBackLeads(asOf),
    );
    const churn = await measured("churn inputs / 2000 invoices", () =>
      getChurnRiskCustomers(asOf),
    );

    expect(customers.value).toHaveLength(PAGE_SIZE);
    expect(jobs.value).toHaveLength(PAGE_SIZE);
    expect(winBack.value.length).toBeLessThanOrEqual(100);
    expect(churn.value.length).toBeLessThanOrEqual(100);
    expect([customers.ms, jobs.ms, winBack.ms, churn.ms].every(Number.isFinite)).toBe(true);
  });
});
