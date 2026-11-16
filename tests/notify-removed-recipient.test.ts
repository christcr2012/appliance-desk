import { beforeEach, describe, expect, it, vi } from "vitest";

// A recipient removed between notify()'s user read and its row write fails the
// Notification user foreign key for the whole batch. notify() keeps everyone
// who still exists and writes once more; anything else still throws.

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  prefFindMany: vi.fn(async () => []),
  createMany: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn }));
vi.mock("@/lib/report-error", () => ({ reportBackgroundError: vi.fn() }));
vi.mock("@/domains/messaging/deliver", () => ({ deliverMessage: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany },
    jobRole: { findMany: vi.fn(async () => []) },
    notificationPreference: { findMany: mocks.prefFindMany },
    notification: { createMany: mocks.createMany },
  },
}));

import { notify } from "@/domains/notifications";

const event = {
  kind: "LEAD_NEW" as const,
  dedupeKey: "LEAD_NEW:race",
  title: "New lead: Race",
  body: "Body",
  href: "/desk/leads/race",
  entityType: "Lead",
  entityId: "lead-race",
};

const people = [
  { id: "owner-1", email: "o@example.test", role: "OWNER", archivedAt: null, jobRoleId: null },
  { id: "admin-gone", email: "g@example.test", role: "ADMIN", archivedAt: null, jobRoleId: null },
];

describe("notify when a recipient disappears mid-send", () => {
  beforeEach(() => {
    mocks.userFindMany.mockReset();
    mocks.createMany.mockReset();
  });

  it("retries once with only the people who still exist", async () => {
    mocks.userFindMany
      .mockResolvedValueOnce(people)
      .mockResolvedValueOnce([{ id: "owner-1" }]);
    mocks.createMany
      .mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "P2003" }))
      .mockResolvedValueOnce({ count: 1 });

    await notify(event);

    expect(mocks.createMany).toHaveBeenCalledTimes(2);
    const retried = mocks.createMany.mock.calls[1][0].data.map((r: { userId: string }) => r.userId);
    expect(retried).toEqual(["owner-1"]);
  });

  it("rethrows any other write error", async () => {
    mocks.userFindMany.mockResolvedValueOnce(people);
    mocks.createMany.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "P1001" }));
    await expect(notify(event)).rejects.toThrow("boom");
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
  });
});
