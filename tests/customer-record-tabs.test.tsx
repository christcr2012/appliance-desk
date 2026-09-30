import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  identity: vi.fn(),
  overview: vi.fn(),
  properties: vi.fn(),
  rentals: vi.fn(),
  service: vi.fn(),
  timeline: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/domains/customers/workspace", () => ({
  CUSTOMER_TABS: [
    "overview",
    "properties",
    "rentals",
    "service",
    "billing",
    "activity",
  ],
  customerTab: (v: string) =>
    ["properties", "rentals", "service", "billing", "activity"].includes(v)
      ? v
      : "overview",
  getCustomerIdentity: m.identity,
  getCustomerOverview: m.overview,
  getCustomerProperties: m.properties,
  getCustomerRentals: m.rentals,
  getCustomerService: m.service,
}));
vi.mock("@/domains/customers/timeline-page", () => ({
  getCustomerTimelinePage: m.timeline,
  timelineFilter: () => "all",
}));
vi.mock("@/app/desk/customers/[id]/operational-customer", () => ({
  OperationalCustomer: () => <p>Staff operational record</p>,
}));
vi.mock("@/app/desk/customers/[id]/billing-context", () => ({
  BillingContext: () => null,
}));
vi.mock("@/app/desk/customers/[id]/resend-activation-button", () => ({
  ResendActivationButton: () => null,
}));
vi.mock("@/app/desk/customers/[id]/add-note-form", () => ({
  AddNoteForm: () => null,
}));
vi.mock("@/app/desk/customers/[id]/contacts-panel", () => ({
  ContactsPanel: () => null,
}));
vi.mock("@/app/desk/customers/[id]/service-addresses-panel", () => ({
  ServiceAddressesPanel: () => null,
}));
vi.mock("@/components/linked-tasks-panel", () => ({
  LinkedTasksPanel: () => null,
}));
import Page from "@/app/desk/customers/[id]/page";
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { role: "OWNER" } });
  m.identity.mockResolvedValue({
    id: "c1",
    user: { name: "Customer", email: "c@example.test" },
    phone: null,
    companyName: null,
    archivedAt: null,
  });
  m.overview.mockResolvedValue({
    activeRentals: 0,
    openService: 0,
    propertyCount: 0,
    nextJob: null,
    tasks: [],
  });
  m.timeline.mockResolvedValue({ entries: [], nextCursor: null });
  m.rentals.mockResolvedValue({
    records: [],
    page: 1,
    totalPages: 1,
    totalCount: 0,
  });
});
it("fetches only overview data and retains all action paths", async () => {
  render(
    await Page({
      params: Promise.resolve({ id: "c1" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(m.overview).toHaveBeenCalledWith("c1");
  expect(m.timeline).not.toHaveBeenCalled();
  expect(m.rentals).not.toHaveBeenCalled();
  expect(m.properties).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "View statement" })).toHaveAttribute(
    "href",
    "/desk/billing/customer/c1",
  );
  expect(
    screen.getByRole("navigation", { name: "Customer record sections" }),
  ).toHaveTextContent("OverviewPropertiesRentalsServiceBillingActivity");
});
it("fetches rentals without timeline or property queries", async () => {
  render(
    await Page({
      params: Promise.resolve({ id: "c1" }),
      searchParams: Promise.resolve({ tab: "rentals", page: "2" }),
    }),
  );
  expect(m.rentals).toHaveBeenCalledWith("c1", 2);
  expect(m.overview).not.toHaveBeenCalled();
  expect(m.timeline).not.toHaveBeenCalled();
  expect(screen.getByText("No agreements yet")).toBeVisible();
});
it("staff receives only the existing operational record even with a billing/activity URL", async () => {
  m.role.mockResolvedValue({ user: { role: "STAFF" } });
  render(
    await Page({
      params: Promise.resolve({ id: "c1" }),
      searchParams: Promise.resolve({ tab: "billing" }),
    }),
  );
  expect(screen.getByText("Staff operational record")).toBeVisible();
  expect(m.identity).not.toHaveBeenCalled();
  expect(m.timeline).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "View statement" })).toBeNull();
});
