import { describe, it, expect, vi, beforeEach } from "vitest";

const agreementFindMany = vi.fn();
const invoiceFindMany = vi.fn();
const paymentFindMany = vi.fn();
const maintenanceRequestFindMany = vi.fn();
const leadFindMany = vi.fn();
const applianceTypeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findMany: (...args: unknown[]) => agreementFindMany(...args) },
    invoice: { findMany: (...args: unknown[]) => invoiceFindMany(...args) },
    payment: { findMany: (...args: unknown[]) => paymentFindMany(...args) },
    maintenanceRequest: { findMany: (...args: unknown[]) => maintenanceRequestFindMany(...args) },
    lead: { findMany: (...args: unknown[]) => leadFindMany(...args) },
    applianceType: { findMany: (...args: unknown[]) => applianceTypeFindMany(...args) },
  },
}));

import {
  getChurnRiskCustomers,
  getWinBackLeads,
  getPriceReviewAgreements,
  getUtilizationFlags,
  getReviewRequestCandidates,
} from "@/domains/growth";

describe("getChurnRiskCustomers", () => {
  beforeEach(() => {
    agreementFindMany.mockReset().mockResolvedValue([]);
    invoiceFindMany.mockReset().mockResolvedValue([]);
    paymentFindMany.mockReset().mockResolvedValue([]);
    maintenanceRequestFindMany.mockReset().mockResolvedValue([]);
  });

  it("only queries ACTIVE agreements and bounds the read", async () => {
    await getChurnRiskCustomers(new Date("2026-09-28"));
    expect(agreementFindMany.mock.calls[0][0]).toMatchObject({ where: { status: "ACTIVE" }, take: 100 });
  });

  it("flags an agreement with stacked signals and leaves out one with nothing wrong", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-risky",
        customerId: "cust-1",
        startDate: new Date("2026-01-01"),
        endDate: null,
        termMonths: 12,
        customer: { user: { name: "Jane Doe", email: "jane@example.com" } },
      },
      {
        id: "agr-fine",
        customerId: "cust-2",
        startDate: new Date("2026-01-01"),
        endDate: null,
        termMonths: 12,
        customer: { user: { name: "Sam Renter", email: "sam@example.com" } },
      },
    ]);
    invoiceFindMany.mockResolvedValue([{ customerId: "cust-1" }, { customerId: "cust-1" }]);
    paymentFindMany.mockResolvedValue([{ invoice: { customerId: "cust-1" } }]);

    const rows = await getChurnRiskCustomers(new Date("2026-09-28"));
    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe("cust-1");
    expect(rows[0].reasons).toContain("2 past-due invoices");
    expect(rows[0].reasons).toContain("1 failed payment recently");
  });
});

describe("getChurnRiskCustomers: saved term end", () => {
  beforeEach(() => {
    invoiceFindMany.mockReset().mockResolvedValue([{ customerId: "c1" }, { customerId: "c1" }]);
    paymentFindMany.mockReset().mockResolvedValue([{ invoice: { customerId: "c1" } }]);
    maintenanceRequestFindMany.mockReset().mockResolvedValue([]);
  });

  const base = {
    id: "agr-1",
    customerId: "c1",
    startDate: new Date("2026-01-01T17:00:00Z"),
    termMonths: 12,
    customer: { user: { name: "Jane Doe", email: "jane@example.com" } },
  };

  it("does not report a term as ending early when delivery came after signing", async () => {
    agreementFindMany.mockResolvedValue([{ ...base, endDate: new Date("2027-02-15T06:59:59Z") }]);
    const rows = await getChurnRiskCustomers(new Date("2026-12-20T12:00:00Z"));
    expect(rows[0].reasons.some((r) => r.startsWith("Term ends in"))).toBe(false);
  });

  it("falls back to start + term months only when no end date was saved", async () => {
    agreementFindMany.mockResolvedValue([{ ...base, endDate: null }]);
    const rows = await getChurnRiskCustomers(new Date("2026-12-20T12:00:00Z"));
    expect(rows[0].reasons.some((r) => r.startsWith("Term ends in"))).toBe(true);
  });
});

describe("getWinBackLeads", () => {
  beforeEach(() => leadFindMany.mockReset().mockResolvedValue([]));

  it("uses lastRealContactAt instead of incidental Lead.updatedAt", async () => {
    leadFindMany.mockResolvedValue([
      {
        id: "lead-1",
        status: "CONTACTED",
        contactName: "Pat",
        companyName: null,
        createdAt: new Date("2026-08-01"),
        updatedAt: new Date("2026-08-02"),
        lastRealContactAt: new Date("2026-09-27"),
      },
    ]);
    expect(await getWinBackLeads(new Date("2026-09-28"))).toEqual([]);
  });

  it("does not let an unrelated recent row update hide a stale NEW lead", async () => {
    leadFindMany.mockResolvedValue([
      {
        id: "lead-2",
        status: "NEW",
        contactName: "Alex",
        companyName: null,
        createdAt: new Date("2026-08-01"),
        updatedAt: new Date("2026-09-27"),
        lastRealContactAt: null,
      },
    ]);
    const rows = await getWinBackLeads(new Date("2026-09-28"));
    expect(rows).toHaveLength(1);
    expect(rows[0].leadId).toBe("lead-2");
  });
});

describe("getPriceReviewAgreements", () => {
  beforeEach(() => agreementFindMany.mockReset().mockResolvedValue([]));

  it("sums each agreement's rental lines for its monthly total", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-1",
        startDate: new Date("2025-01-01"),
        customer: { user: { name: "Jane Doe", email: "jane@example.com" } },
        lines: [{ monthlyPriceCents: 6000 }, { monthlyPriceCents: 4000 }],
      },
    ]);
    const rows = await getPriceReviewAgreements(new Date("2026-09-28"));
    expect(rows[0].monthlyTotalCents).toBe(10000);
  });
});

describe("getUtilizationFlags", () => {
  beforeEach(() => applianceTypeFindMany.mockReset().mockResolvedValue([]));

  it("queries custody episodes, not assignment history", async () => {
    await getUtilizationFlags(new Date("2026-09-28T12:00:00Z"));
    const applianceSelect = applianceTypeFindMany.mock.calls[0][0].select.appliances.select;
    expect(applianceSelect.custodyEpisodes).toBeDefined();
    expect(applianceSelect.assignments).toBeUndefined();
  });

  it("flags sustained current and recent physical custody with enough units", async () => {
    const start = new Date("2026-08-01T00:00:00Z");
    applianceTypeFindMany.mockResolvedValue([
      {
        id: "type-1",
        name: "Washer",
        appliances: Array.from({ length: 3 }, () => ({
          createdAt: start,
          custodyEpisodes: [{ startedOn: start, endedOn: null, closedAt: null }],
        })),
      },
    ]);
    const rows = await getUtilizationFlags(new Date("2026-09-28T12:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flag: "SHORTAGE", currentUtilizationFraction: 1, rolling30DayUtilizationFraction: 1 });
  });
});

describe("getReviewRequestCandidates", () => {
  beforeEach(() => {
    agreementFindMany.mockReset().mockResolvedValue([]);
    invoiceFindMany.mockReset().mockResolvedValue([]);
  });

  it("excludes a customer with a past-due invoice", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-1",
        customerId: "cust-1",
        billingStartedAt: new Date("2026-01-01"),
        customer: { user: { name: "Jane Doe", email: "jane@example.com" } },
      },
    ]);
    invoiceFindMany.mockResolvedValue([{ customerId: "cust-1" }]);
    expect(await getReviewRequestCandidates(new Date("2026-09-28"))).toEqual([]);
  });
});
