import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  customer: { findUnique: vi.fn() },
  serviceAddress: { count: vi.fn() },
  rentalAgreement: { count: vi.fn(), findMany: vi.fn() },
  job: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  maintenanceRequest: { count: vi.fn(), findMany: vi.fn() },
  staffTask: { findMany: vi.fn() },
  customerNote: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
}));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ requireRole: guard }));
import {
  getCustomerOverview,
  customerTab,
  getCustomerRentals,
  getCustomerService,
  validInitialAddress,
} from "@/domains/customers/workspace";
import {
  getCustomerTimelinePage,
  mergeTimelinePage,
  readTimelineCursor,
  timelineCursorWhere,
  timelineFilter,
  type LinkedTimelineEntry,
} from "@/domains/customers/timeline-page";
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ user: { role: "OWNER" } });
});
describe("customer record reads", () => {
  it("clamps pages and keeps the same customer scope and stable row order", async () => {
    db.rentalAgreement.count.mockResolvedValue(101);
    db.rentalAgreement.findMany.mockResolvedValue([]);
    const page = await getCustomerRentals("c1", 99);
    expect(page).toMatchObject({ page: 5, totalCount: 101, totalPages: 5 });
    expect(db.rentalAgreement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: "c1" },
        take: 25,
        skip: 100,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });
  it("counts service requests independently of the ten-row preview", async () => {
    db.job.count.mockResolvedValue(51);
    db.maintenanceRequest.count.mockResolvedValue(29);
    db.maintenanceRequest.findMany.mockResolvedValue([]);
    db.job.findMany.mockResolvedValue([]);
    expect(await getCustomerService("c1", 2)).toMatchObject({
      page: 2,
      openRequestCount: 29,
      totalCount: 51,
    });
    expect(db.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        skip: 25,
        where: { customerId: "c1" },
      }),
    );
  });
  it("denies staff before any database access", async () => {
    guard.mockRejectedValue(new Error("denied"));
    await expect(getCustomerRentals("c1")).rejects.toThrow("denied");
    expect(db.rentalAgreement.count).not.toHaveBeenCalled();
  });
  it("accepts only a property belonging to the requested customer", () => {
    const customers = [
      { id: "c1", serviceAddresses: [{ id: "a1" }] },
      { id: "c2", serviceAddresses: [{ id: "a2" }] },
    ];
    expect(validInitialAddress(customers, "c1", "a1")).toBe("a1");
    expect(validInitialAddress(customers, "c1", "a2")).toBeUndefined();
    expect(validInitialAddress(customers, "unknown", "a1")).toBeUndefined();
    expect(customerTab("bogus")).toBe("overview");
  });
});
describe("merged customer history", () => {
  it("pages all 137 equal-timestamp entries once, including the source boundary", () => {
    const date = new Date("2026-09-30T12:00:00Z");
    const entries: LinkedTimelineEntry[] = Array.from(
      { length: 137 },
      (_, i) => ({
        id: `${i < 69 ? "note" : "audit"}-${String(i).padStart(3, "0")}`,
        kind: i < 69 ? "note" : "activity",
        summary: "Recorded",
        detail: null,
        authorName: "Operator",
        createdAt: date,
        href: null,
      }),
    );
    let cursor: ReturnType<typeof readTimelineCursor> = null;
    const seen: string[] = [];
    function after(e: LinkedTimelineEntry) {
      if (!cursor) return true;
      const rawId = e.id.slice(e.kind === "note" ? 5 : 6);
      return (
        e.createdAt < new Date(cursor.createdAt) ||
        (e.createdAt.getTime() === new Date(cursor.createdAt).getTime() &&
          (e.kind === cursor.kind
            ? rawId < cursor.id
            : e.kind === "activity" && cursor.kind === "note"))
      );
    }
    for (let i = 0; i < 10; i++) {
      const remain = entries.filter(after);
      const stream = (kind: string) =>
        remain
          .filter((e) => e.kind === kind)
          .sort((a, b) => b.id.localeCompare(a.id))
          .slice(0, 26);
      const page = mergeTimelinePage(stream("note"), stream("activity"));
      seen.push(...page.entries.map((e) => e.id));
      if (!page.nextCursor) break;
      cursor = readTimelineCursor(page.nextCursor);
      expect(cursor).not.toBeNull();
    }
    expect(seen).toHaveLength(137);
    expect(new Set(seen).size).toBe(137);
    expect(new Set(seen)).toEqual(new Set(entries.map((e) => e.id)));
  });
  it("handles malformed cursors without failing the page", () => {
    for (const raw of [
      "bad",
      "x".repeat(513),
      Buffer.from(
        JSON.stringify({ createdAt: "invalid", kind: "note", id: "abc" }),
      ).toString("base64url"),
    ])
      expect(readTimelineCursor(raw)).toBeNull();
    expect(timelineFilter("invalid")).toBe("all");
  });
  it("includes activity at a note timestamp and excludes notes at an activity timestamp", () => {
    const cursor = {
      createdAt: "2026-09-30T12:00:00.000Z",
      kind: "note" as const,
      id: "n1",
    };
    expect(timelineCursorWhere("activity", cursor).OR).toHaveLength(2);
    expect(
      timelineCursorWhere("note", { ...cursor, kind: "activity" }).OR,
    ).toHaveLength(1);
  });
  it("scopes history, preserves authors and links, omits raw audit payloads", async () => {
    db.customerNote.findMany.mockResolvedValue([
      {
        id: "n1",
        body: "Called",
        createdAt: new Date(),
        author: { name: "Owner", email: "owner@example.test" },
      },
    ]);
    db.rentalAgreement.findMany.mockResolvedValue([{ id: "a1" }]);
    db.job.findMany.mockResolvedValue([]);
    db.maintenanceRequest.findMany.mockResolvedValue([]);
    db.auditLog.findMany.mockResolvedValue([
      {
        id: "audit1",
        action: "agreement.create",
        entityType: "RentalAgreement",
        entityId: "a1",
        createdAt: new Date(),
        user: { name: "Operator", email: "op@example.test" },
      },
    ]);
    const page = await getCustomerTimelinePage("c1");
    expect(page.entries.find((e) => e.kind === "note")).toMatchObject({
      authorName: "Owner",
      detail: "Called",
    });
    expect(page.entries.find((e) => e.kind === "activity")).toMatchObject({
      authorName: "Operator",
      href: "/desk/agreements/a1",
      detail: null,
    });
    const query = db.auditLog.findMany.mock.calls[0][0];
    expect(query.take).toBe(26);
    expect(query.select.newValue).toBeUndefined();
    expect(query.where.AND[0].OR).toContainEqual({
      entityType: "Customer",
      entityId: "c1",
    });
  });
  it("notes-only view avoids every audit/entity query", async () => {
    db.customerNote.findMany.mockResolvedValue([]);
    await getCustomerTimelinePage("c1", "notes");
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
    expect(db.job.findMany).not.toHaveBeenCalled();
  });
});

it("next visit excludes expired appointments and uses a stable future order", async () => {
  const now = new Date("2026-10-01T18:00:00Z");
  await getCustomerOverview("c1", now);
  expect(db.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { customerId: "c1", status: { in: ["SCHEDULED", "IN_PROGRESS"] }, scheduledAt: { gte: now } },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  }));
});
