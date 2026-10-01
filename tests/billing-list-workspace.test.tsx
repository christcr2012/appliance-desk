import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({
  guard: vi.fn(),
  count: vi.fn(),
  page: vi.fn(),
  balances: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("@/domains/billing", () => ({
  getInvoicesCount: m.count,
  getInvoicesPage: m.page,
  getCustomersWithOpenBalances: m.balances,
}));
import Page from "@/app/desk/billing/page";
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.guard.mockResolvedValue({});
  m.count.mockResolvedValue(1);
  m.page.mockResolvedValue([
    {
      id: "i1",
      invoiceNumber: 123,
      status: "DELINQUENT",
      billingPeriodStart: null,
      amountDueCents: 5000,
      amountPaidCents: 1000,
      customer: {
        id: "c1",
        user: { name: "Customer", email: "c@example.test" },
      },
    },
  ]);
  m.balances.mockResolvedValue([]);
});
it("All invoices clears a delinquent filter and each invoice links to its exact customer-scoped record", async () => {
  render(
    await Page({ searchParams: Promise.resolve({ filter: "delinquent" }) }),
  );
  expect(
    screen.getByRole("link", { name: "All invoices" }).getAttribute("href"),
  ).toBe("/desk/billing");
  expect(screen.getByRole("link", { name: "#123" }).getAttribute("href")).toBe(
    "/desk/billing/customer/c1/invoice/i1",
  );
  expect(m.page).toHaveBeenCalledWith({ delinquentOnly: true }, 0, 25);
});
it("statements do not fetch the invoice list and authorization runs before finance reads", async () => {
  render(
    await Page({ searchParams: Promise.resolve({ filter: "statements" }) }),
  );
  expect(m.page).not.toHaveBeenCalled();
  expect(m.count).not.toHaveBeenCalled();
  m.guard.mockRejectedValue(new Error("denied"));
  m.balances.mockClear();
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "denied",
  );
  expect(m.balances).not.toHaveBeenCalled();
});
