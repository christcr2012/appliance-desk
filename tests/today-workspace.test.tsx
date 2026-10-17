import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  exceptions: vi.fn(),
  jobs: vi.fn(),
  tasks: vi.fn(),
  requests: vi.fn(),
  setup: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/domains/exceptions", () => ({
  getExceptionOverview: m.exceptions,
  getTodaysJobs: m.jobs,
}));
vi.mock("@/domains/tasks/workspace", () => ({ getDueTaskSummary: m.tasks }));
vi.mock("@/domains/setup/checklist", () => ({ getSetupChecklist: m.setup }));
vi.mock("@/lib/prisma", () => ({
  prisma: { maintenanceRequest: { count: m.requests } },
}));
vi.mock("@/app/desk/tasks/task-row", () => ({ TaskRow: () => null }));

import TodayPage from "@/app/desk/today/page";

const stepRow = (key: string, title: string, done: boolean, detail: string, href: string) =>
  ({ key, title, done, detail, href });
const incompleteChecklist = {
  steps: [
    stepRow("business", "Business details", true, "Your business name, phone, email and address are filled in.", "/desk/settings?section=profile"),
    stepRow("service-area", "Service area", false, "Add the cities or ZIP codes you serve.", "/desk/settings?section=service-area"),
    stepRow("prices", "Prices", false, "Set a monthly price for at least one appliance or set.", "/desk/settings?section=products"),
    stepRow("tax", "Tax setup", false, "Add your Colorado sales tax account. 2 more after that.", "/desk/sales-tax/setup"),
    stepRow("payments", "Payments", true, "Connected in test mode, so no real money moves yet.", "/desk/settings?section=integrations"),
    stepRow("email", "Email", false, "Customer emails are switched off. Turn them on in Settings → Notifications when you're ready.", "/desk/settings?section=notifications"),
  ],
  doneCount: 2,
  total: 6,
  complete: false,
};
const completeChecklist = {
  steps: incompleteChecklist.steps.map(step => ({ ...step, done: true })),
  doneCount: 6,
  total: 6,
  complete: true,
};

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { role: "STAFF" } });
  m.exceptions.mockResolvedValue({ items: [], snoozed: [], truncated: [] });
  m.jobs.mockResolvedValue([]);
  m.tasks.mockResolvedValue({ tasks: [], totalCount: 0, overdueCount: 0 });
  m.requests.mockResolvedValue(3);
  m.setup.mockResolvedValue(completeChecklist);
});

it("shows honest empty states and excludes restricted staff create links", async () => {
  render(await TodayPage());

  expect(screen.getByText("Nothing needs attention right now.")).toBeVisible();
  expect(screen.getByText("No visits today")).toBeVisible();
  expect(screen.getByText("No follow-ups due")).toBeVisible();
  expect(screen.queryByRole("link", { name: "New visit" })).toBeNull();
  expect(
    screen.getByRole("link", { name: /Open service requests/ }),
  ).toHaveTextContent("3");
  expect(m.requests).toHaveBeenCalledWith({
    where: {
      status: { in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"] },
    },
  });
});

it("offers owners a visit action and excludes cancelled jobs from Today", async () => {
  m.role.mockResolvedValue({ user: { role: "OWNER" } });
  m.jobs.mockResolvedValue(
    ["SCHEDULED", "CANCELLED", "IN_PROGRESS", "COMPLETED"].map((status, i) => ({
      id: `j${i}`,
      type: "DELIVERY",
      status,
      scheduledAt: new Date("2026-09-30T16:00:00Z"),
      customer: { user: { name: `Customer ${i}`, email: "test@example.test" } },
      serviceAddress: null,
    })),
  );

  render(await TodayPage());

  expect(screen.getByRole("link", { name: "New visit" })).toHaveAttribute(
    "href",
    "/desk/jobs/new",
  );
  expect(
    screen.getByRole("link", { name: /Visits today/ }),
  ).toHaveTextContent("3");
  expect(screen.queryByText("Customer 1")).toBeNull();
  expect(screen.getByText("Customer 0")).toBeVisible();
  expect(screen.getByText("Customer 2")).toBeVisible();
  expect(screen.getByText("Customer 3")).toBeVisible();
});

it("says plainly when a group has more items than are shown", async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    category: "OVERDUE_JOB" as const,
    severity: "high" as const,
    title: `Delivery is overdue ${index + 1}`,
    detail: "Scheduled and not done.",
    href: `/desk/jobs/j${index + 1}`,
    since: new Date("2026-09-01T12:00:00Z"),
  }));
  m.exceptions.mockResolvedValue({
    items,
    snoozed: [],
    truncated: [{ category: "OVERDUE_JOB", total: 73, shown: 50 }],
  });

  render(await TodayPage());

  expect(screen.getByText("and 23 more")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Overdue job" }),
  ).toBeVisible();
});

it("shows the owner a Get set up card in order, with Done or the one missing thing and a working link", async () => {
  m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
  m.setup.mockResolvedValue(incompleteChecklist);

  render(await TodayPage());

  expect(m.setup).toHaveBeenCalledWith("owner-1");
  const card = within(screen.getByTestId("setup-card"));
  expect(card.getByRole("heading", { name: "Get set up" })).toBeVisible();
  expect(card.getByText(/2 of 6 steps done/)).toBeVisible();
  const rows = card.getAllByRole("listitem");
  const titles = ["Business details", "Service area", "Prices", "Tax setup", "Payments", "Email"];
  expect(rows).toHaveLength(6);
  rows.forEach((row, index) => {
    expect(row.querySelector("p")?.textContent).toMatch(new RegExp(`^${index + 1}\\. ${titles[index]}`));
  });
  expect(within(rows[0]).getByText("Done ✓")).toBeVisible();
  expect(within(rows[1]).getByText("Not done yet")).toBeVisible();
  expect(within(rows[1]).getByText("Add the cities or ZIP codes you serve.")).toBeVisible();
  expect(within(rows[3]).getByText("Add your Colorado sales tax account. 2 more after that.")).toBeVisible();
  expect(card.getByRole("link", { name: "Finish this, service area" })).toHaveAttribute("href", "/desk/settings?section=service-area");
  expect(card.getByRole("link", { name: "Finish this, tax setup" })).toHaveAttribute("href", "/desk/sales-tax/setup");
  expect(card.getByRole("link", { name: "Review, business details" })).toHaveAttribute("href", "/desk/settings?section=profile");
  expect(card.getByRole("link", { name: "Finish this, email" })).toHaveAttribute("href", "/desk/settings?section=notifications");
});

it("hides the card once every step is done", async () => {
  m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
  m.setup.mockResolvedValue(completeChecklist);

  render(await TodayPage());

  expect(m.setup).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("setup-card")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Get set up" })).toBeNull();
});

it("never asks for, or shows, the checklist to admins or staff", async () => {
  m.setup.mockResolvedValue(incompleteChecklist);
  for (const role of ["ADMIN", "STAFF"]) {
    cleanup();
    m.role.mockResolvedValue({ user: { id: role + "-1", role } });
    render(await TodayPage());
    expect(screen.queryByTestId("setup-card"), role).toBeNull();
    expect(screen.queryByText("Get set up"), role).toBeNull();
  }
  expect(m.setup).not.toHaveBeenCalled();
});

it("keeps Today working, without the card, when the checklist cannot be read", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
    m.setup.mockRejectedValue(new Error("database unavailable"));

    render(await TodayPage());

    expect(screen.getByText("No visits today")).toBeVisible();
    expect(screen.queryByTestId("setup-card")).toBeNull();
    expect(log).toHaveBeenCalledWith("Setup checklist unavailable:", "database unavailable");
  } finally {
    log.mockRestore();
  }
});
