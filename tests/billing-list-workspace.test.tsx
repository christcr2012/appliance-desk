import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const m = vi.hoisted(() => ({
  guard: vi.fn(),
  bills: vi.fn(),
  counts: vi.fn(),
  totals: vi.fn(),
  balances: vi.fn(),
  detail: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${to}` });
  }),
}));
vi.mock("next/navigation", async () => ({ ...(await import("./kit/kit-test-env")), redirect: m.redirect }));
vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("@/lib/prisma", () => ({ prisma: { invoice: { fields: { amountPaidCents: "paid" } } } }));
vi.mock("@/domains/billing", () => ({ getCustomersWithOpenBalances: m.balances }));
vi.mock("@/domains/billing/bills-list", () => ({ getBills: m.bills, getBillCounts: m.counts, getBillTotals: m.totals }));
vi.mock("@/domains/billing/invoice-detail", () => ({ getInvoiceDetail: m.detail }));
vi.mock("@/app/desk/billing/deposits-tab", () => ({ DepositsTab: () => <p>Deposits list</p> }));
vi.mock("@/app/desk/billing/waiting-tab", () => ({ WaitingTab: () => <p>Waiting list</p> }));
import Page from "@/app/desk/billing/page";

const row = {
  id: "i1",
  number: 1042,
  customerId: "c1",
  customerName: "Maria Lopez",
  companyName: null,
  forText: "October rent",
  amountCents: 7000,
  owedCents: 7000,
  status: "DELINQUENT",
  dueDate: new Date("2026-10-20T06:00:00Z"),
  paidCents: 0,
  autopay: true,
  createdAt: new Date("2026-10-01T06:00:00Z"),
  payPath: "STRIPE_LINK",
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ user: { role: "OWNER" } });
  m.bills.mockResolvedValue({ rows: [row], nextCursor: null, capped: false });
  m.counts.mockResolvedValue({ open: 9, "past-due": 2, paid: 40, closed: 1, drafts: 0 });
  m.totals.mockResolvedValue({ count: 2, owedCents: 14000 });
  m.balances.mockResolvedValue([]);
  m.detail.mockResolvedValue(null);
});

it("old ?filter= links land on the new tabs and views", async () => {
  for (const [filter, to] of [
    ["delinquent", "/desk/billing?status=past-due"],
    ["statements", "/desk/billing?view=by-customer"],
    ["deposits", "/desk/billing?view=deposits"],
    ["waiting", "/desk/billing?view=waiting"],
  ]) {
    await expect(Page({ searchParams: Promise.resolve({ filter, page: "3" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(m.redirect).toHaveBeenLastCalledWith(to);
  }
  expect(m.bills).not.toHaveBeenCalled();
});

it("refuses before any money is read (staff never reach bills)", async () => {
  const denial = new Error("denied");
  m.guard.mockRejectedValue(denial);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toBe(denial);
  // ACCT-1: the accountant gets the read-only list too; staff stay refused.
  expect(m.guard).toHaveBeenCalledWith("OWNER", "ADMIN", "ACCOUNTANT");
  expect(m.bills).not.toHaveBeenCalled();
  expect(m.counts).not.toHaveBeenCalled();
  expect(m.totals).not.toHaveBeenCalled();
});

it("past due: tabs with counts, summary, pay buttons and the customer-scoped bill link", async () => {
  render(await Page({ searchParams: Promise.resolve({ status: "past-due" }) }));
  expect(m.bills.mock.calls[0][0]).toMatchObject({ status: "past-due", sort: "due-asc" });
  const tabs = within(screen.getByRole("navigation", { name: "Bill status" }));
  expect(tabs.getByRole("link", { name: "Past due 2" })).toHaveAttribute("aria-current", "page");
  expect(tabs.getByRole("link", { name: "Open 9" })).toBeVisible();
  expect(tabs.queryByRole("link", { name: /Drafts/ })).toBeNull();
  expect(screen.getAllByText("2 bills · $140.00 still owed").length).toBeGreaterThan(0);
  const take = screen.getAllByRole("link", { name: "Take payment" });
  expect(take[0]).toHaveAttribute("href", "/desk/billing/customer/c1/invoice/i1#take-payment");
  expect(screen.getAllByRole("link", { name: "Maria Lopez" })[0]).toHaveAttribute("href", "/desk/billing/customer/c1/invoice/i1");
  expect(screen.queryByText(/invoice/i)).toBeNull();
});

it("with a search that finds nothing, offers Clear filters", async () => {
  m.bills.mockResolvedValue({ rows: [], nextCursor: null, capped: false });
  render(await Page({ searchParams: Promise.resolve({ status: "open", q: "nobody" }) }));
  expect(screen.getByText("No bills match")).toBeVisible();
  expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/desk/billing?status=open");
});

it("the by-customer view keeps the old balances list and does not read the bill list", async () => {
  render(await Page({ searchParams: Promise.resolve({ view: "by-customer" }) }));
  expect(screen.getByRole("heading", { name: "Who owes money" })).toBeVisible();
  expect(m.balances).toHaveBeenCalled();
  expect(m.bills).not.toHaveBeenCalled();
});

it("?open= renders the side panel from the bill detail", async () => {
  m.detail.mockResolvedValue({
    id: "i1",
    invoiceNumber: 1042,
    status: "DELINQUENT",
    dueDate: new Date("2026-10-20T06:00:00Z"),
    createdAt: new Date("2026-10-01T06:00:00Z"),
    amountDueCents: 7000,
    amountPaidCents: 0,
    balanceCents: 7000,
    lineItems: [],
    payments: [{ id: "p1", amountCents: 7000, method: "card", status: "failed", createdAt: new Date("2026-10-20T12:00:00Z") }],
    customer: { id: "c1", name: "Maria Lopez", companyName: null, email: "m@example.test" },
  });
  render(await Page({ searchParams: Promise.resolve({ status: "past-due", open: "i1" }) }));
  const panel = within(screen.getByRole("complementary", { name: "Bill #1042" }));
  expect(panel.getByText("Still owed")).toBeVisible();
  expect(panel.getByText("Payment failed")).toBeVisible();
  expect(panel.getByRole("link", { name: "Send reminder" })).toHaveAttribute("href", "/desk/billing/customer/c1/invoice/i1#take-payment");
  expect(panel.getByRole("link", { name: "Open full bill →" })).toBeVisible();
});
