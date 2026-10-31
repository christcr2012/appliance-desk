import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  role: "STAFF",
  requireRole: vi.fn(),
  jobs: vi.fn(),
  board: vi.fn(),
  maintenance: vi.fn(),
  visits: vi.fn(),
  visitCounts: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/domains/jobs", () => ({
  getJobsPage: mocks.jobs,
  getJobsCount: vi.fn(async () => 1),
  getDispatchBoardJobs: mocks.board,
}));
// AR-5: the Visits list reads its own cursor module, and both list pages read the
// assignable team members for the Who picker — mock both surfaces.
vi.mock("@/domains/jobs/visits-list", () => ({
  getVisits: mocks.visits,
  getVisitCounts: mocks.visitCounts,
}));
vi.mock("@/domains/staff", () => ({
  getAssignableTeamMembers: vi.fn(async () => []),
}));
vi.mock("@/components/desk/context-communication-panel", () => ({
  ContextCommunicationPanel: () => null,
}));
vi.mock("@/app/desk/_text/send-text-panel", () => ({
  SendTextPanel: () => null,
}));
vi.mock("@/app/desk/_text/call-panel", () => ({
  CallPanel: () => null,
}));
vi.mock("@/domains/maintenance", () => ({
  getMaintenanceRequestById: mocks.maintenance,
}));
vi.mock("@/app/desk/maintenance/actions", () => ({
  updateMaintenanceStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/desk/jobs",
  useSearchParams: () => new URLSearchParams(),
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
  mocks.visits.mockResolvedValue({
    rows: [
      {
        id: "job-1",
        type: "DELIVERY",
        status: "SCHEDULED",
        scheduledAt: new Date(2026, 8, 30, 10),
        durationMinutes: 60,
        assignedTo: { id: "u-1", name: "Sam Driver" },
        customerName: "Customer",
        customerEmail: "customer@example.test",
        addressLine: "123 Test, Greeley",
        appliances: [],
        applianceNumbers: [],
        noShowAt: null,
      },
    ],
    nextCursor: null,
  });
  mocks.visitCounts.mockResolvedValue({
    upcoming: 1,
    noTime: 0,
    done: 0,
    cancelled: 0,
  });
  mocks.board.mockResolvedValue({
    scheduled: [job],
    conflictCandidates: [job],
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
        () =>
          MaintenancePage({
            params: Promise.resolve({ id: "request-1" }),
            // AR-5: the record page takes a tab search param (Problem/Visits/Messages).
            searchParams: Promise.resolve({}),
          }),
      ],
    ] as const) {
      it(`${name} matches the role while retaining operational content`, async () => {
        mocks.role = role;
        render(await load());
        const links = screen.queryAllByRole("link", { name: /schedule a visit/i });
        if (role === "STAFF") expect(links).toHaveLength(0);
        else {
          // The kit list header renders the primary action twice (header
          // button + phone Fab); every copy must point at the same place.
          const href =
            name === "maintenance"
              ? "/desk/jobs/new?maintenanceRequestId=request-1"
              : "/desk/jobs/new";
          expect(links.length).toBeGreaterThan(0);
          for (const l of links) expect(l).toHaveAttribute("href", href);
        }
        if (name === "maintenance")
          expect(
            screen.getByRole("button", { name: "Look at it" }),
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
    screen.queryByRole("link", { name: /schedule a visit/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Look at it" })).toBeEnabled();
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
