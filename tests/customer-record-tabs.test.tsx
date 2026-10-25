import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  identity: vi.fn(),
  overview: vi.fn(),
  properties: vi.fn(),
  rentals: vi.fn(),
  service: vi.fn(),
  timeline: vi.fn(),
  summary: vi.fn(),
  nextSteps: vi.fn(),
  bills: vi.fn(),
  messages: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${to}` });
  }),
}));
vi.mock("next/navigation", async () => ({ ...(await import("./kit/kit-test-env")), redirect: m.redirect, notFound: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/prisma", () => ({ prisma: { invoice: { fields: { amountPaidCents: "paid" } } } }));
vi.mock("@/components/desk/record-connections", () => ({ RecordConnections: () => null }));
vi.mock("@/domains/customers/workspace", () => ({
  getCustomerIdentity: m.identity,
  getCustomerOverview: m.overview,
  getCustomerProperties: m.properties,
  getCustomerRentals: m.rentals,
  getCustomerService: m.service,
}));
vi.mock("@/domains/customers/timeline-page", () => ({ getCustomerTimelinePage: m.timeline }));
vi.mock("@/domains/customers/record", async (original) => ({
  ...(await original<object>()),
  getCustomerSummary: m.summary,
  getCustomerNextSteps: m.nextSteps,
}));
vi.mock("@/domains/billing/bills-list", () => ({ getBills: m.bills }));
vi.mock("@/domains/messaging/history", () => ({ getMessageHistory: m.messages }));
vi.mock("@/app/desk/customers/[id]/operational-customer", () => ({ OperationalCustomer: () => <p>Staff operational record</p> }));
vi.mock("@/app/desk/customers/[id]/billing-context", () => ({ BillingContext: () => null }));
vi.mock("@/app/desk/customers/[id]/resend-activation-button", () => ({ ResendActivationButton: () => null }));
vi.mock("@/app/desk/customers/[id]/add-note-form", () => ({ AddNoteForm: () => null }));
vi.mock("@/app/desk/customers/[id]/contacts-panel", () => ({ ContactsPanel: () => null }));
vi.mock("@/app/desk/customers/[id]/service-addresses-panel", () => ({ ServiceAddressesPanel: () => null }));
vi.mock("@/components/desk/property-service-context", () => ({ PropertyServiceContext: () => null }));
vi.mock("@/components/linked-tasks-panel", () => ({ LinkedTasksPanel: () => null }));
vi.mock("@/app/desk/customers/actions", () => ({ resendActivationEmailAction: vi.fn() }));
import Page from "@/app/desk/customers/[id]/page";

const summary = {
  status: "active",
  customerSince: new Date("2026-03-10T18:00:00Z"),
  city: "Greeley",
  primaryAddress: "1402 10th Ave, Greeley",
  monthlyRentCents: 7000,
  owedCents: 7000,
  oldestOpenBillId: "i1",
  nextBill: { date: new Date("2026-11-01T18:00:00Z"), rentCents: 7000 },
  autopay: true,
  renting: "Washer + dryer",
  onTime: { paidOnTime: 5, counted: 6 },
  hasPortalLogin: true,
  liveRentalCount: 1,
};
const call = (search: Record<string, string> = {}) => Page({ params: Promise.resolve({ id: "c1" }), searchParams: Promise.resolve(search) });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { role: "OWNER" } });
  m.identity.mockResolvedValue({ id: "c1", user: { name: "Maria Lopez", email: "maria@example.test" }, phone: "970-555-0100", companyName: null, archivedAt: null });
  m.summary.mockResolvedValue(summary);
  m.nextSteps.mockResolvedValue([]);
  m.messages.mockResolvedValue([]);
  m.timeline.mockResolvedValue({ entries: [], nextCursor: null });
  m.rentals.mockResolvedValue({ records: [], page: 1, totalPages: 1, totalCount: 0 });
  m.service.mockResolvedValue({ jobs: [], requests: [], openRequestCount: 0, page: 1, totalPages: 1, totalCount: 0 });
  m.bills.mockResolvedValue({ rows: [], nextCursor: null, capped: false });
  m.overview.mockResolvedValue({ tasks: [] });
  m.properties.mockResolvedValue({ serviceAddresses: [], contacts: [], rentalAgreements: [], jobs: [], maintenanceRequests: [] });
});

it("with no tab: phone Activity and desktop Rentals, header words, stats and Take payment to the oldest open bill", async () => {
  render(await call());
  expect(screen.getByRole("heading", { level: 1, name: "Maria Lopez" })).toBeVisible();
  expect(screen.getAllByText("Customer since March 2026 · Greeley").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Owes $70.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Monthly rent").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Nov 1 · autopay on").length).toBeGreaterThan(0);
  expect(screen.getAllByText("5 of last 6").length).toBe(1); // desktop only
  const take = screen.getAllByRole("link", { name: "Take payment" });
  expect(take[0]).toHaveAttribute("href", "/desk/billing/customer/c1/invoice/i1#take-payment");
  const strips = screen.getAllByRole("navigation", { name: "Customer sections" });
  expect(strips[0]).toHaveTextContent("ActivityRentals 1BillsVisitsDetails");
  expect(strips[1]).toHaveTextContent("Rentals 1BillsVisitsMessagesDetails");
  expect(m.rentals).toHaveBeenCalledWith("c1", 1);
  expect(m.bills).not.toHaveBeenCalled();
  expect(m.properties).not.toHaveBeenCalled();
  expect(screen.getByText("No rentals yet")).toBeVisible();
  const bar = within(screen.getByRole("group", { name: "Customer actions" }));
  expect(bar.getByRole("link", { name: "New quote" })).toHaveAttribute("href", "/desk/estimates/new?customerId=c1");
  expect(bar.getByRole("link", { name: "Schedule visit" })).toHaveAttribute("href", "/desk/jobs/new?customerId=c1");
});

it("without anything owed the primary is New quote", async () => {
  m.summary.mockResolvedValue({ ...summary, owedCents: 0, oldestOpenBillId: null });
  render(await call());
  expect(screen.queryByRole("link", { name: "Take payment" })).toBeNull();
  expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
});

it("old tab links move to the new sections", async () => {
  for (const [tab, to] of [
    ["overview", "/desk/customers/c1"],
    ["properties", "/desk/customers/c1?tab=details"],
    ["service", "/desk/customers/c1?page=2&tab=visits"],
    ["billing", "/desk/customers/c1?tab=details#referrals"],
  ]) {
    await expect(call(tab === "service" ? { tab, page: "2" } : { tab })).rejects.toThrow("NEXT_REDIRECT");
    expect(m.redirect).toHaveBeenLastCalledWith(to);
  }
});

it("the Bills section reads only this customer's open and recent paid bills", async () => {
  render(await call({ tab: "bills" }));
  expect(m.bills).toHaveBeenCalledWith(expect.objectContaining({ status: "open", customerId: "c1" }), expect.any(Date));
  expect(m.bills).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", customerId: "c1", pageSize: 10 }), expect.any(Date));
  expect(screen.getAllByText("No bills yet").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("link", { name: "Full statement" })[0]).toHaveAttribute("href", "/desk/billing/customer/c1");
});

it("staff receive only the existing operational record, with no money reads", async () => {
  m.role.mockResolvedValue({ user: { role: "STAFF" } });
  render(await call({ tab: "bills" }));
  expect(screen.getByText("Staff operational record")).toBeVisible();
  expect(m.identity).not.toHaveBeenCalled();
  expect(m.summary).not.toHaveBeenCalled();
  expect(m.bills).not.toHaveBeenCalled();
  expect(screen.queryByText(/\$/)).toBeNull();
});
