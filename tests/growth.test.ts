import { describe, it, expect, vi, beforeEach } from "vitest";

// DB-wrapper half of the growth signals (src/domains/growth/index.ts) — the
// pure math is covered by tests/growth-churn.test.ts and
// tests/growth-signals.test.ts. These check query shape and assembly with a
// mocked Prisma.

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

  it("only queries ACTIVE agreements", async () => {
    await getChurnRiskCustomers(new Date("2026-09-28"));
    expect(agreementFindMany.mock.calls[0][0].where).toEqual({ status: "ACTIVE" });
  });

  it("flags an agreement with enough stacked signals and leaves out one with nothing wrong", async () => {
    agreementFindMany.mockResolvedValue([
      {
        id: "agr-risky",
        customerId: "cust-1",
        startDate: new Date("2026-01-01"),
        termMonths: 12,
        customer: { user: { name: "Jane Doe", email: "jane@example.com" } },
      },
      {
        id: "agr-fine",
        customerId: "cust-2",
        startDate: new Date("2026-01-01"),
        termMonths: 12,
        customer: { user: { name: "Sam Renter", email: "sam@example.com" } },
      },
    ]);
    // 2 past-due invoices (15 points) alone isn't enough to cross the
    // at-risk threshold (20) — add a failed payment too (+10) so this
    // customer is the one that should come back flagged.
    invoiceFindMany.mockResolvedValue([{ customerId: "cust-1" }, { customerId: "cust-1" }]);
    paymentFindMany.mockResolvedValue([{ invoice: { customerId: "cust-1" } }]);

    const rows = await getChurnRiskCustomers(new Date("2026-09-28"));

    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe("cust-1");
    expect(rows[0].reasons).toContain("2 past-due invoices");
    expect(rows[0].reasons).toContain("1 failed payment recently");
  });
});

describe("getWinBackLeads", () => {
  beforeEach(() => {
    leadFindMany.mockReset().mockResolvedValue([]);
  });

  it("only queries NEW/CONTACTED/LOST leads", async () => {
    await getWinBackLeads(new Date("2026-09-28"));
    expect(leadFindMany.mock.calls[0][0].where).toEqual({
      status: { in: ["NEW", "CONTACTED", "LOST"] },
    });
  });

  it("leaves out a lead updated recently", async () => {
    leadFindMany.mockResolvedValue([
      {
        id: "lead-1",
        status: "NEW",
        contactName: "Pat",
        companyName: null,
        updatedAt: new Date("2026-09-27"),
      },
    ]);
    const rows = await getWinBackLeads(new Date("2026-09-28"));
    expect(rows).toEqual([]);
  });
});

describe("getPriceReviewAgreements", () => {
  beforeEach(() => {
    agreementFindMany.mockReset().mockResolvedValue([]);
  });

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
    expect(rows).toHaveLength(1);
    expect(rows[0].monthlyTotalCents).toBe(10000);
  });
});

describe("getUtilizationFlags", () => {
  beforeEach(() => {
    applianceTypeFindMany.mockReset().mockResolvedValue([]);
  });

  it("skips a type with no appliances", async () => {
    applianceTypeFindMany.mockResolvedValue([{ id: "type-1", name: "Washer", appliances: [] }]);
    const rows = await getUtilizationFlags(new Date("2026-09-28"));
    expect(rows).toEqual([]);
  });

  it("flags a fully-utilized type with enough units", async () => {
    const assignedAt = new Date("2026-01-01");
    applianceTypeFindMany.mockResolvedValue([
      {
        id: "type-1",
        name: "Washer",
        appliances: Array.from({ length: 3 }, () => ({
          createdAt: assignedAt,
          assignments: [{ assignedAt, unassignedAt: null }],
        })),
      },
    ]);
    const rows = await getUtilizationFlags(new Date("2026-09-28"));
    expect(rows).toHaveLength(1);
    expect(rows[0].flag).toBe("SHORTAGE");
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
    const rows = await getReviewRequestCandidates(new Date("2026-09-28"));
    expect(rows).toEqual([]);
  });
});
