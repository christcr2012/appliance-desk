import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "owner-1" } }),
}));
vi.mock("@/domains/inventory", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createApplianceUnits: (...a: unknown[]) => m.create(...a),
}));

import { createApplianceUnitsAction } from "@/app/desk/inventory/actions";
import { parseOptionalBusinessDate } from "@/lib/business-date";

describe("R11 purchase date is a strict Colorado business date", () => {
  it.each([
    ["2026-01-15", "2026-01-15T07:00:00.000Z"],
    ["2026-07-15", "2026-07-15T06:00:00.000Z"],
    ["2026-03-08", "2026-03-08T07:00:00.000Z"],
    ["2026-11-01", "2026-11-01T06:00:00.000Z"],
  ])("%s becomes Colorado midnight", (key, iso) => {
    const parsed = parseOptionalBusinessDate(key);
    expect(parsed.ok && parsed.value?.toISOString()).toBe(iso);
  });

  it.each(["2026-02-30", "10/05/2026", "yesterday", "2026-1-5", "2026-13-01"])(
    "rejects %s",
    (bad) => expect(parseOptionalBusinessDate(bad)).toEqual({ ok: false }),
  );

  it("blank means not given", () => {
    expect(parseOptionalBusinessDate("")).toEqual({ ok: true, value: null });
  });

  describe("through the add-appliances action", () => {
    const base = { applianceTypeId: "type-1", quantity: 1 };
    beforeEach(() => m.create.mockReset().mockResolvedValue(undefined));

    it("refuses an impossible date and creates nothing", async () => {
      const result = await createApplianceUnitsAction({ ...base, purchaseDate: "2026-02-30" });
      expect(result.status).toBe("error");
      expect(m.create).not.toHaveBeenCalled();
    });

    it("passes a valid date as Colorado midnight, never midnight UTC", async () => {
      await createApplianceUnitsAction({ ...base, purchaseDate: "2026-07-15" });
      const input = m.create.mock.calls[0]![1] as { purchaseDate: Date };
      expect(input.purchaseDate.toISOString()).toBe("2026-07-15T06:00:00.000Z");
    });
  });
});
