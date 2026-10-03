import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ records: vi.fn(), stats: vi.fn(), role: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/domains/billing/revenue-records", () => ({ getRevenueRecords: m.records }));
vi.mock("@/domains/billing", () => ({ getRevenueDashboard: m.stats }));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
import RevenuePage from "@/app/desk/revenue/page";
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  m.stats.mockResolvedValue({
    mrrCents: 0, arrCents: 0, collectedThisMonthCents: 0, collectedAllTimeCents: 0,
    activeRentalCount: 0, activeCustomerCount: 0, newRentalsThisMonth: 0,
    endedOrCancelledThisMonth: 0, pastDueCents: 0, pastDueInvoiceCount: 0,
    failedPaymentsCount: 0, mrrTrend: [],
  });
  m.records.mockResolvedValue({
    meta: { totalCount: 1, page: 1, pageSize: 25, totalPages: 1, skip: 0 },
    totalCents: 4500,
    toCreditCents: 0,
    rows: [{ id: "source-record", amountCents: 4500, createdAt: new Date("2026-10-01T00:00:00Z"),
      basis: "Recorded payment", method: "check", customerId: "customer-456", customerName: "Test Customer",
      unallocatedCents: 500, heldCents: 0,
      invoices: [{ id: "invoice-123", invoiceNumber: 123, amountCents: 4000 }, { id: "invoice-124", invoiceNumber: 124, amountCents: 0 }] }],
  });
});
it.each(["payments", "refunds"])("%s rows link to the customer statement and each exact desk invoice", async (source) => {
  render(await RevenuePage({ searchParams: Promise.resolve({ source, scope: "all" }) }));
  expect(screen.getByRole("link", { name: "Test Customer" })).toHaveAttribute("href", "/desk/billing/customer/customer-456");
  expect(screen.getByRole("link", { name: "Invoice #123" })).toHaveAttribute(
    "href", "/desk/billing/customer/customer-456/invoice/invoice-123",
  );
  expect(screen.getByRole("link", { name: "Invoice #124" })).toHaveAttribute(
    "href", "/desk/billing/customer/customer-456/invoice/invoice-124",
  );
  expect(screen.getByText(/\$5 held as account credit/)).toBeVisible();
  expect(m.role).toHaveBeenCalledWith("OWNER", "ADMIN");
  expect(m.records).toHaveBeenCalledWith(source, false, undefined, expect.any(Date));
});
