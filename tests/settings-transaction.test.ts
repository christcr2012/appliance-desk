import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
  queryRaw: vi.fn(),
  userFind: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { updateBusinessSettings } from "@/domains/settings";
beforeEach(() => {
  vi.clearAllMocks();
  m.read.mockResolvedValue({ publicBusinessName: "Before" });
  m.save.mockResolvedValue({ publicBusinessName: "After" });
  m.audit.mockResolvedValue({});
  m.queryRaw.mockResolvedValue([]);
  m.userFind.mockResolvedValue({ id: "owner", role: "OWNER", archivedAt: null });
  m.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: m.queryRaw,
      user: { findUnique: m.userFind },
      businessSettings: { findUnique: m.read, upsert: m.save },
      auditLog: { create: m.audit },
    }),
  );
});
it("reads, saves and records the audit in the same transaction", async () => {
  await expect(
    updateBusinessSettings("owner", { publicBusinessName: "After" }),
  ).resolves.toEqual({ publicBusinessName: "After" });
  expect(m.transaction).toHaveBeenCalledTimes(1);
  expect(m.audit).toHaveBeenCalledWith({
    data: expect.objectContaining({
      userId: "owner",
      oldValue: { publicBusinessName: "Before" },
      newValue: { publicBusinessName: "After" },
    }),
  });
  expect(m.save).toHaveBeenCalledWith(
    expect.objectContaining({ update: { publicBusinessName: "After" } }),
  );
});
it("does not report a successful save when audit creation fails", async () => {
  m.audit.mockRejectedValue(new Error("audit failed"));
  await expect(
    updateBusinessSettings("owner", { publicBusinessName: "After" }),
  ).rejects.toThrow("audit failed");
});
it("rejects a deactivated or non-admin author before touching settings", async () => {
  m.userFind.mockResolvedValue({ id: "owner", role: "ADMIN", archivedAt: new Date() });
  await expect(
    updateBusinessSettings("owner", { publicBusinessName: "After" }),
  ).rejects.toThrow(/no longer has access/);
  expect(m.save).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
  m.userFind.mockResolvedValue({ id: "owner", role: "STAFF", archivedAt: null });
  await expect(
    updateBusinessSettings("owner", { publicBusinessName: "After" }),
  ).rejects.toThrow(/no longer has access/);
  expect(m.save).not.toHaveBeenCalled();
});
