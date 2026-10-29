import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ records: vi.fn(), role: vi.fn() }));
vi.mock("next/navigation", () => import("./kit/kit-test-env"));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/domains/billing/revenue-records", () => ({ getRevenueRecords: m.records }));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
import RevenuePage from "@/app/desk/money/income/page";
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
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
  for (const link of screen.getAllByRole("link", { name: "Test Customer" })) {
    expect(link).toHaveAttribute("href", "/desk/billing/customer/customer-456");
  }
  for (const link of screen.getAllByRole("link", { name: "Invoice #123" })) {
    expect(link).toHaveAttribute(
      "href",
      "/desk/billing/customer/customer-456/invoice/invoice-123",
    );
  }
  for (const link of screen.getAllByRole("link", { name: "Invoice #124" })) {
    expect(link).toHaveAttribute(
      "href",
      "/desk/billing/customer/customer-456/invoice/invoice-124",
    );
  }
  // The kit income page formats money with formatMoney ("$5.00"); the old
  // revenue page's formatCents dropped the ".00". Same words, kit format.
  expect(screen.getAllByText(/\$5\.00 held as account credit/)).toHaveLength(2);
  expect(m.role).toHaveBeenCalledWith("OWNER", "ADMIN");
  expect(m.records).toHaveBeenCalledWith(source, false, undefined, expect.any(Date), undefined);
});
