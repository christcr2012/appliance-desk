import { describe, expect, it, vi } from "vitest";

// AR-5 section 1 fix 4: getMaintenanceRequestById had no role check of its own — its page callers
// checked, but Next.js layouts do not re-run on every navigation, so the read must check the role
// itself (the same pattern as tests/desk-list-role-checks.test.ts). This proves the refusal happens
// before any database read, and that a team session is let through to the read.
const { refused, touched } = vi.hoisted(() => ({ refused: new Error("NOT_ALLOWED"), touched: vi.fn() }));
const { requireRole } = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    maintenanceRequest: {
      findUnique: (...args: unknown[]) => {
        touched(...args);
        return Promise.resolve({ id: "req-1" });
      },
    },
  },
}));

import { getMaintenanceRequestById } from "@/domains/maintenance";

describe("getMaintenanceRequestById role check", () => {
  it("refuses anyone the session check refuses, before reading", async () => {
    requireRole.mockRejectedValue(refused);
    touched.mockClear();
    await expect(getMaintenanceRequestById("req-1")).rejects.toBe(refused);
    expect(requireRole).toHaveBeenCalledWith("OWNER", "ADMIN", "STAFF");
    expect(touched).not.toHaveBeenCalled();
  });

  it("lets a team session through to the read", async () => {
    requireRole.mockResolvedValue({ user: { id: "u1", role: "STAFF" } });
    touched.mockClear();
    await expect(getMaintenanceRequestById("req-1")).resolves.toEqual({ id: "req-1" });
    expect(touched).toHaveBeenCalledTimes(1);
  });
});
