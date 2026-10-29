import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "perf-owner", role: "OWNER" } })),
}));

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  getCustomerList,
  getCustomerSegmentCounts,
} from "@/domains/customers/list";
import { measuredMedian, PERF_ENABLED } from "./fixtures";

// CU-1 (CUSTOMERS spec section 7): 20,000 customers / 60,000 addresses /
// 30,000 agreements / 120,000 bills / 40,000 visits in throwaway Postgres.
// List reads per sort, the counts query, and each search flavour stay under
// 150 ms on the CI database. Runs only in the Performance Baselines job.
const CUSTOMERS = 20_000;

describe.skipIf(!PERF_ENABLED)("CU-1 20,000-customer list capacity (isolated CI Postgres)", () => {
  const tag = `p${randomUUID().replaceAll("-", "").slice(0, 11)}`;
  const prefix = `cu1-${tag}-`;
  const now = new Date();

  beforeAll(async () => {
    const base = `TIMESTAMP '2026-01-01 00:00:00 UTC'`;
    await prisma.$executeRaw`
      INSERT INTO "User" ("id", "name", "email", "role", "createdAt", "updatedAt")
      SELECT ${prefix} || 'u' || g, 'Perf ' || ${tag} || ' ' || g,
        ${prefix} || g || '@example.test', 'CUSTOMER', ${base}::timestamp + (g || ' minutes')::interval,
        ${base}::timestamp + (g || ' minutes')::interval
      FROM generate_series(1, ${CUSTOMERS}) g`;
    await prisma.$executeRaw`
      INSERT INTO "Customer" ("id", "userId", "referralCode", "phone", "phoneDigits", "createdAt", "updatedAt")
      SELECT ${prefix} || 'c' || g, ${prefix} || 'u' || g, ${prefix} || 'ref' || g,
        '970555' || lpad(g::text, 4, '0'), '970555' || lpad(g::text, 4, '0'),
        ${base}::timestamp + (g || ' minutes')::interval, ${base}::timestamp + (g || ' minutes')::interval
      FROM generate_series(1, ${CUSTOMERS}) g`;
    await prisma.$executeRaw`
      INSERT INTO "ServiceAddress" ("id", "customerId", "line1", "city", "zip", "createdAt", "updatedAt")
      SELECT ${prefix} || 'a' || g || '-' || n, ${prefix} || 'c' || g,
        g || ' Perf Street', CASE WHEN g % 5 = 0 THEN 'Windsor' ELSE 'Greeley' END, '80631',
        ${base}::timestamp, ${base}::timestamp
      FROM generate_series(1, ${CUSTOMERS}) g, generate_series(1, 3) n`;
    await prisma.$executeRaw`
      INSERT INTO "RentalAgreement" ("id", "customerId", "serviceAddressId", "status", "firstDeliveredOn", "createdAt", "updatedAt")
      SELECT ${prefix} || 'r' || g || '-' || n, ${prefix} || 'c' || g, ${prefix} || 'a' || g || '-1',
        CASE WHEN n = 2 THEN 'ENDED' WHEN g % 7 = 0 THEN 'SCHEDULED' ELSE 'ACTIVE' END::"RentalAgreementStatus",
        ${base}::timestamp, ${base}::timestamp, ${base}::timestamp
      FROM generate_series(1, ${CUSTOMERS}) g, generate_series(1, 2) n
      WHERE n = 1 OR g <= 10000`;
    await prisma.$executeRaw`
      INSERT INTO "RentalLine" ("id", "agreementId", "label", "monthlyPriceCents", "createdAt", "updatedAt")
      SELECT ${prefix} || 'l' || g || '-' || n, ${prefix} || 'r' || g || '-' || n,
        'Washer', 6000 + (g % 5) * 500, ${base}::timestamp, ${base}::timestamp
      FROM generate_series(1, ${CUSTOMERS}) g, generate_series(1, 2) n
      WHERE n = 1 OR g <= 10000`;
    await prisma.$executeRaw`
      INSERT INTO "Invoice" ("id", "customerId", "status", "amountDueCents", "amountPaidCents", "dueDate", "createdAt", "updatedAt")
      SELECT ${prefix} || 'i' || g || '-' || n, ${prefix} || 'c' || g,
        CASE WHEN n <= 4 THEN 'OPEN' WHEN n = 5 THEN 'DELINQUENT' ELSE 'PAID' END::"InvoiceStatus",
        12000, CASE WHEN n = 6 THEN 12000 ELSE 2000 END,
        DATE '2026-10-01' + (g % 40), ${base}::timestamp, ${base}::timestamp
      FROM generate_series(1, ${CUSTOMERS}) g, generate_series(1, 6) n`;
    await prisma.$executeRaw`
      INSERT INTO "Job" ("id", "customerId", "type", "status", "scheduledAt", "createdAt", "updatedAt")
      SELECT ${prefix} || 'j' || g || '-' || n, ${prefix} || 'c' || g,
        CASE WHEN n = 1 THEN 'DELIVERY' ELSE 'REMOVAL' END::"JobType", 'SCHEDULED',
        TIMESTAMP '2026-11-05 15:00:00 UTC' + (g || ' minutes')::interval,
        ${base}::timestamp, ${base}::timestamp
      FROM generate_series(1, ${CUSTOMERS}) g, generate_series(1, 2) n`;
    expect(await prisma.customer.count({ where: { id: { startsWith: prefix } } })).toBe(CUSTOMERS);
  }, 300_000);

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.invoice.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.rentalLine.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.customer.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  }, 300_000);

  it("lists a page under 150 ms for every sort", async () => {
    for (const sort of ["attention", "name", "rent-desc", "owed-desc", "newest", "since"] as const) {
      const { ms } = await measuredMedian(`list sort=${sort}`, () =>
        getCustomerList({ segment: "active", sort }, now),
      );
      expect(ms, `sort ${sort}`).toBeLessThan(150);
    }
  }, 300_000);

  it("counts all segments under 150 ms", async () => {
    const { ms, value } = await measuredMedian("segment counts", () =>
      getCustomerSegmentCounts({}, now),
    );
    expect(value.active).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(150);
  }, 120_000);

  it("searches by name, phone digits and address under 150 ms", async () => {
    const byName = await measuredMedian("search name", () =>
      getCustomerList({ segment: "all", q: `Perf ${tag} 19999` }, now),
    );
    expect(byName.value.rows.length).toBe(1);
    expect(byName.ms).toBeLessThan(150);
    const byPhone = await measuredMedian("search phone", () =>
      getCustomerList({ segment: "all", q: "9705551999" }, now),
    );
    expect(byPhone.value.rows.length).toBeGreaterThanOrEqual(1);
    expect(byPhone.ms).toBeLessThan(150);
    const byAddress = await measuredMedian("search address", () =>
      getCustomerList({ segment: "all", q: "19999 Perf Street" }, now),
    );
    expect(byAddress.value.rows.length).toBe(1);
    expect(byAddress.ms).toBeLessThan(150);
  }, 300_000);
});
