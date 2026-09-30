import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  role: "STAFF",
  requireRole: vi.fn(),
  jobs: vi.fn(),
  board: vi.fn(),
  maintenance: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/domains/jobs", () => ({
  getJobsPage: mocks.jobs,
  getJobsCount: vi.fn(async () => 1),
  getDispatchBoardJobs: mocks.board,
}));
vi.mock("@/domains/maintenance", () => ({
  getMaintenanceRequestById: mocks.maintenance,
}));
vi.mock("@/app/desk/maintenance/actions", () => ({
  updateMaintenanceStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("not found");
  },
}));

import JobsPage from "@/app/desk/jobs/page";
import DispatchPage from "@/app/desk/dispatch/page";
import MaintenancePage from "@/app/desk/maintenance/[id]/page";
import { MaintenanceDetailPanel } from "@/app/desk/maintenance/[id]/maintenance-detail-panel";

const job = {
  id: "job-1",
  type: "DELIVERY",
  status: "SCHEDULED",
  scheduledAt: new Date(2026, 8, 30, 10),
  customer: { user: { name: "Customer", email: "customer@example.test" } },
  serviceAddress: { line1: "123 Test", city: "Greeley" },
  checklist: [],
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.role = "STAFF";
  mocks.requireRole.mockImplementation(async (...roles: string[]) => {
    if (!roles.includes(mocks.role)) throw new Error("unauthorized");
    return { user: { role: mocks.role } };
  });
  mocks.jobs.mockResolvedValue([job]);
  mocks.board.mockResolvedValue({
    scheduled: [job],
    unscheduled: [{ ...job, id: "job-2", scheduledAt: null }],
  });
  mocks.maintenance.mockResolvedValue({
    id: "request-1",
    status: "SUBMITTED",
    customerId: "customer-1",
    customer: job.customer,
    appliance: null,
    priority: "NORMAL",
    openedAt: new Date(),
    problem: "Check washer",
    photos: [],
    jobs: [],
  });
});

describe.each(["STAFF", "OWNER", "ADMIN"])(
  "%s scheduling entry points",
  (role) => {
    for (const [name, load] of [
      ["jobs", () => JobsPage({ searchParams: Promise.resolve({}) })],
      [
        "dispatch",
        () =>
          DispatchPage({
            searchParams: Promise.resolve({ date: "2026-09-30" }),
          }),
      ],
      [
        "maintenance",
        () => MaintenancePage({ params: Promise.resolve({ id: "request-1" }) }),
      ],
    ] as const) {
      it(`${name} matches the role while retaining operational content`, async () => {
        mocks.role = role;
        render(await load());
        const link = screen.queryByRole("link", { name: /schedule a job/i });
        if (role === "STAFF") expect(link).not.toBeInTheDocument();
        else
          expect(link).toHaveAttribute(
            "href",
            name === "maintenance"
              ? "/desk/jobs/new?maintenanceRequestId=request-1"
              : "/desk/jobs/new",
          );
        if (name === "maintenance")
          expect(
            screen.getByRole("button", { name: "Mark Reviewing" }),
          ).toBeEnabled();
        else
          expect(
            screen
              .getAllByRole("link")
              .some((l) => l.getAttribute("href") === "/desk/jobs/job-1"),
          ).toBe(true);
        expect(mocks.requireRole).toHaveBeenCalledWith(
          "OWNER",
          "ADMIN",
          "STAFF",
        );
      });
    }
  },
);

it("the maintenance panel hides scheduling unless the server grants it", () => {
  render(
    <MaintenanceDetailPanel
      request={{ id: "r-1", status: "SUBMITTED", customerId: "c-1" }}
    />,
  );
  expect(
    screen.queryByRole("link", { name: /schedule a job/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark Reviewing" })).toBeEnabled();
});

it.each(["day", "week", "agenda"])(
  "%s dispatch lists contain list items around populated job links",
  async (view) => {
    render(
      await DispatchPage({
        searchParams: Promise.resolve({ view, date: "2026-09-30" }),
      }),
    );
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      expect(list.children.length).toBeGreaterThan(0);
      for (const child of list.children) expect(child.tagName).toBe("LI");
    }
  },
);
