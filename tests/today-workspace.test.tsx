import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  exceptions: vi.fn(),
  jobs: vi.fn(),
  tasks: vi.fn(),
  setup: vi.fn(),
  health: vi.fn(),
  budget: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("next/navigation", () => import("./kit/kit-test-env"));
vi.mock("@/lib/session", () => ({ requireRole: m.role }));
vi.mock("@/domains/exceptions", () => ({
  getExceptionOverview: m.exceptions,
  getTodaysJobs: m.jobs,
}));
vi.mock("@/domains/tasks/workspace", () => ({ getDueTaskSummary: m.tasks }));
vi.mock("@/domains/setup/checklist", () => ({ getSetupChecklist: m.setup }));
vi.mock("@/domains/dashboard/weekly-health", () => ({ getWeeklyHealth: m.health }));
vi.mock("@/domains/budget/planning", () => ({ getBudgetPlanning: m.budget }));
vi.mock("@/domains/workspace", async (original) => ({ ...(await original<object>()), getWorkspace: m.workspace }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import TodayPage from "@/app/desk/today/page";

const stepRow = (key: string, title: string, done: boolean, href: string) => ({ key, title, done, detail: "", href });
const incompleteChecklist = {
  steps: [
    stepRow("business", "Business details", true, "/desk/settings?section=profile"),
    stepRow("service-area", "Service area", false, "/desk/settings?section=service-area"),
    stepRow("prices", "Prices", false, "/desk/settings?section=products"),
  ],
  doneCount: 1,
  total: 3,
  complete: false,
};
const completeChecklist = { ...incompleteChecklist, steps: incompleteChecklist.steps.map((s) => ({ ...s, done: true })), doneCount: 3, complete: true };

const item = (over: Record<string, unknown> = {}) => ({
  category: "OVERDUE_JOB" as const,
  severity: "medium" as const,
  title: "Delivery is overdue",
  detail: "Scheduled and not done.",
  href: "/desk/jobs/j1",
  since: new Date("2026-09-01T12:00:00Z"),
  todoKey: "a".repeat(64),
  ...over,
});

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "staff-1", role: "STAFF", name: "Sam Staff", email: "staff@example.test" } });
  m.exceptions.mockResolvedValue({ items: [], snoozed: [], truncated: [] });
  m.jobs.mockResolvedValue([]);
  m.tasks.mockResolvedValue({ tasks: [], totalCount: 0, overdueCount: 0 });
  m.setup.mockResolvedValue(completeChecklist);
  m.health.mockResolvedValue({ moneyInCents: 184000, outRenting: 24, rentableTotal: 27, overdueBills: 2 });
  m.budget.mockResolvedValue({ upcoming: [], envelopes: [], sourceReasons: [], sourceStatus: "ok", revision: 1 });
  m.workspace.mockResolvedValue({ version: 1, prefs: { pinnedActionIds: [], hiddenOptionalCardIds: [], savedViews: [] } });
});

it("staff see no money: no health strip is asked for or shown; empty states are plain", async () => {
  render(await TodayPage());
  expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  expect(screen.getByText("You're all caught up")).toBeVisible();
  expect(screen.getByText("No visits today")).toBeVisible();
  expect(m.health).not.toHaveBeenCalled();
  expect(m.budget).not.toHaveBeenCalled();
  expect(screen.queryByText("Money in")).toBeNull();
  expect(screen.queryByText(/\$/)).toBeNull();
});

it("owners see the health strip words and numbers", async () => {
  m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER", name: "Chris Robinson", email: "owner@example.test" } });
  render(await TodayPage());
  expect(screen.getAllByText("Money in").length).toBeGreaterThan(0);
  expect(screen.getAllByText("$1,840.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("24 of 27").length).toBeGreaterThan(0);
  expect(screen.getAllByText("2 bills").length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "Your account" })).toHaveTextContent("CR");
});

it("shows today's visits as cards and leaves out cancelled ones", async () => {
  m.jobs.mockResolvedValue(
    ["SCHEDULED", "CANCELLED"].map((status, i) => ({
      id: `j${i}`,
      type: "DELIVERY",
      status,
      durationMinutes: 60,
      scheduledAt: new Date("2026-09-30T16:00:00Z"),
      customer: { user: { name: `Customer ${i}`, email: "c@example.test" } },
      serviceAddress: { line1: "1402 10th Ave", city: "Greeley" },
    })),
  );
  render(await TodayPage());
  const visits = within(screen.getByRole("region", { name: "Today's visits" }));
  expect(visits.getByText(/— Customer 0/)).toBeVisible();
  expect(screen.queryByText(/Customer 1/)).toBeNull();
  expect(visits.getByRole("link", { name: "Open visit" })).toHaveAttribute("href", "/desk/jobs/j0");
  expect(visits.getByRole("link", { name: "Directions" }).getAttribute("href")).toContain("maps.google.com");
});

it("groups the inbox with counts and says when a group has more than is shown", async () => {
  const items = Array.from({ length: 50 }, (_, index) => item({ title: `Delivery is overdue ${index + 1}`, href: `/desk/jobs/j${index + 1}`, todoKey: undefined }));
  m.exceptions.mockResolvedValue({ items, snoozed: [], truncated: [{ category: "OVERDUE_JOB", total: 73, shown: 50 }] });
  render(await TodayPage());
  const chips = within(screen.getByRole("navigation", { name: "Inbox groups" }));
  expect(chips.getByRole("link", { name: "All 73" })).toHaveAttribute("aria-current", "page");
  expect(chips.getByRole("link", { name: "Rentals & visits 73" })).toBeVisible();
  expect(screen.getByText("Rentals & visits: Showing 50 of 73")).toBeVisible();
});

it("offers Snooze to owners as a link that opens the sheet, never to staff", async () => {
  m.exceptions.mockResolvedValue({ items: [item()], snoozed: [item({ title: "Waiting one", snooze: { until: new Date("2026-11-01T12:00:00Z"), reason: "x", actorName: "Chris" } })], truncated: [] });
  render(await TodayPage());
  expect(screen.queryByRole("link", { name: /Snoozed \(1\)/ })).toBeVisible();
  cleanup();
  m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER", name: "Chris", email: "o@example.test" } });
  render(await TodayPage({ searchParams: Promise.resolve({ group: "snoozed" }) }));
  expect(screen.getByRole("button", { name: "Bring back" })).toBeVisible();
});

it("shows the owner the one-line setup card with Continue to the first undone step", async () => {
  m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER", name: "Chris", email: "o@example.test" } });
  m.setup.mockResolvedValue(incompleteChecklist);
  render(await TodayPage());
  expect(m.setup).toHaveBeenCalledWith("owner-1");
  const card = within(screen.getByTestId("setup-card"));
  expect(card.getByText(/Set up your business/)).toHaveTextContent("Set up your business · 1 of 3 done");
  expect(card.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/desk/settings?section=service-area");
});

it("hides the card once every step is done, and never asks for it for admins or staff", async () => {
  m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER", name: "Chris", email: "o@example.test" } });
  render(await TodayPage());
  expect(screen.queryByTestId("setup-card")).toBeNull();
  m.setup.mockClear();
  for (const role of ["ADMIN", "STAFF"]) {
    cleanup();
    m.role.mockResolvedValue({ user: { id: role + "-1", role, name: null, email: "x@example.test" } });
    render(await TodayPage());
    expect(screen.queryByTestId("setup-card"), role).toBeNull();
  }
  expect(m.setup).not.toHaveBeenCalled();
});

it("keeps Today working, without the card, when the checklist cannot be read", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    m.role.mockResolvedValue({ user: { id: "owner-1", role: "OWNER", name: "Chris", email: "o@example.test" } });
    m.setup.mockRejectedValue(new Error("database unavailable"));
    render(await TodayPage());
    expect(screen.getByText("No visits today")).toBeVisible();
    expect(screen.queryByTestId("setup-card")).toBeNull();
    expect(log).toHaveBeenCalledWith("Setup checklist unavailable:", "database unavailable");
  } finally {
    log.mockRestore();
  }
});

it("shows the not-in-job-role notice as one line", async () => {
  render(await TodayPage({ searchParams: Promise.resolve({ screen: "not-in-job-role" }) }));
  expect(screen.getAllByRole("status").some((el) => el.textContent === "You don't have access to that screen.")).toBe(true);
});
