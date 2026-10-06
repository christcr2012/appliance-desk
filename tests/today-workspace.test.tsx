import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  exceptions: vi.fn(),
  jobs: vi.fn(),
  tasks: vi.fn(),
  requests: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/domains/exceptions", () => ({
  getExceptionOverview: m.exceptions,
  getTodaysJobs: m.jobs,
}));
vi.mock("@/domains/tasks/workspace", () => ({ getDueTaskSummary: m.tasks }));
vi.mock("@/lib/prisma", () => ({
  prisma: { maintenanceRequest: { count: m.requests } },
}));
vi.mock("@/app/desk/tasks/task-row", () => ({ TaskRow: () => null }));

import TodayPage from "@/app/desk/today/page";

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { role: "STAFF" } });
  m.exceptions.mockResolvedValue({ items: [], truncated: [] });
  m.jobs.mockResolvedValue([]);
  m.tasks.mockResolvedValue({ tasks: [], totalCount: 0, overdueCount: 0 });
  m.requests.mockResolvedValue(3);
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
    truncated: [{ category: "OVERDUE_JOB", total: 73, shown: 50 }],
  });

  render(await TodayPage());

  expect(screen.getByText("and 23 more")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Overdue job" }),
  ).toBeVisible();
});
