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
  getExceptions: m.exceptions,
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
  m.exceptions.mockResolvedValue([]);
  m.jobs.mockResolvedValue([]);
  m.tasks.mockResolvedValue({ tasks: [], totalCount: 0, overdueCount: 0 });
  m.requests.mockResolvedValue(3);
});
it("shows honest empty states and excludes restricted staff create links", async () => {
  render(await TodayPage());
  expect(screen.getByText("Nothing urgent right now")).toBeVisible();
  expect(screen.getByText("No follow-ups due")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Create rental" })).toBeNull();
  expect(
    screen.getByRole("link", { name: /Open service requests/ }),
  ).toHaveTextContent("3");
  expect(m.requests).toHaveBeenCalledWith({
    where: {
      status: { in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"] },
    },
  });
});
it("offers owners a rental action, prioritizes work in progress and excludes cancelled jobs", async () => {
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
  expect(screen.getByRole("link", { name: "Create rental" })).toHaveAttribute(
    "href",
    "/desk/agreements/new",
  );
  expect(screen.getByRole("link", { name: "Open next job" })).toHaveAttribute(
    "href",
    "/desk/jobs/j2",
  );
  expect(
    screen.getByRole("link", { name: /Jobs remaining today/ }),
  ).toHaveTextContent("2");
  expect(screen.queryByText("Customer 1")).toBeNull();
  expect(screen.getByText("Completed today (1)")).toBeVisible();
});
