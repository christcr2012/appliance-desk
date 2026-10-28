// AR-8 (SETTINGS spec section 1 + section 8): the settings-history bounds.
// checkUndo's newer-rows scan is capped at 500 — at the cap the undo is
// refused as too old instead of being checked against a partial picture —
// and listSettingsHistory guards itself with requireRole (OWNER/ADMIN), so
// a STAFF caller is refused by the read itself, not only by its page.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "OWNER" as string,
  auditFindUnique: vi.fn(),
  auditFindMany: vi.fn(),
  settingsFindUnique: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(mocks.role)) throw new Error("Not allowed");
    return { user: { id: "u1", role: mocks.role } };
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findUnique: mocks.auditFindUnique, findMany: mocks.auditFindMany },
    businessSettings: { findUnique: mocks.settingsFindUnique },
  },
}));

import { listSettingsHistory, previewSettingsUndo } from "@/domains/settings/history";

const ROW = {
  id: "audit-1",
  action: "settings.update",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  oldValue: { lateFeeFlatCents: 500 },
  newValue: { lateFeeFlatCents: 600 },
};

function newerRows(count: number, touchesKey: boolean) {
  return Array.from({ length: count }, (_, i) => ({
    oldValue: touchesKey ? { lateFeeFlatCents: 600 + i } : { publicPhone: "x" },
    newValue: touchesKey ? { lateFeeFlatCents: 601 + i } : { publicPhone: "y" },
  }));
}

describe("checkUndo bound (via previewSettingsUndo)", () => {
  it("refuses as too old when 500 newer settings rows exist", async () => {
    mocks.auditFindUnique.mockResolvedValue(ROW);
    mocks.settingsFindUnique.mockResolvedValue({ lateFeeFlatCents: 600 });
    mocks.auditFindMany.mockResolvedValue(newerRows(500, false));
    const preview = await previewSettingsUndo("audit-1", "lateFeeFlatCents");
    expect(preview).toEqual({ ok: false, reason: "This change is too old to undo here." });
    // The scan itself must be the bounded one the spec names.
    const call = mocks.auditFindMany.mock.calls.at(-1)?.[0];
    expect(call?.take).toBe(500);
    expect(call?.orderBy).toEqual({ createdAt: "asc" });
  });

  it("still previews normally when only a few newer rows exist and none touched the key", async () => {
    mocks.auditFindUnique.mockResolvedValue(ROW);
    mocks.settingsFindUnique.mockResolvedValue({ lateFeeFlatCents: 600 });
    mocks.auditFindMany.mockResolvedValue(newerRows(3, false));
    const preview = await previewSettingsUndo("audit-1", "lateFeeFlatCents");
    expect(preview.ok).toBe(true);
  });

  it("still refuses when a newer row within the bound touched the key", async () => {
    mocks.auditFindUnique.mockResolvedValue(ROW);
    mocks.settingsFindUnique.mockResolvedValue({ lateFeeFlatCents: 601 });
    mocks.auditFindMany.mockResolvedValue(newerRows(2, true));
    const preview = await previewSettingsUndo("audit-1", "lateFeeFlatCents");
    expect(preview.ok).toBe(false);
  });
});

describe("listSettingsHistory role guard", () => {
  it("refuses STAFF inside the read itself", async () => {
    mocks.role = "STAFF";
    await expect(listSettingsHistory()).rejects.toThrow("Not allowed");
  });

  it("admits OWNER and reads", async () => {
    mocks.role = "OWNER";
    mocks.auditFindMany.mockResolvedValue([]);
    mocks.settingsFindUnique.mockResolvedValue({});
    await expect(listSettingsHistory()).resolves.toEqual([]);
  });
});
