import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "owner-1" } }),
}));
vi.mock("@/domains/jobs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setJobRepairCosts: (...a: unknown[]) => m.set(...a),
}));

import { setJobRepairCostsAction } from "@/app/desk/jobs/actions";
import { parseRepairCostDollars } from "@/domains/jobs/repair-costs";

const cents = (raw: string) => {
  const r = parseRepairCostDollars(raw, "Parts cost");
  return r.ok ? r.cents : "error";
};

describe("R12 repair cost parser", () => {
  it.each([
    ["123.45", 12345],
    ["125", 12500],
    ["0", 0],
    ["0.5", 50],
    ["$20.10", 2010],
    ["", null],
    ["   ", null],
    ["100000", 10_000_000],
  ])("%j -> %j", (raw, expected) => expect(cents(raw)).toBe(expected));

  it.each(["-1", "abc", "1.001", "1e3", "12,50", "1.", ".5", "NaN", "Infinity", "100000.01", "9999999999"])(
    "rejects %j instead of guessing",
    (raw) => expect(cents(raw)).toBe("error"),
  );
});

describe("R12 through the action and the domain", () => {
  beforeEach(() => m.set.mockReset().mockResolvedValue(undefined));

  it("a malformed amount is an error, not a silently cleared cost", async () => {
    const result = await setJobRepairCostsAction("j-1", { partsCostDollars: "abc", laborCostDollars: "10" });
    expect(result.status).toBe("error");
    expect(m.set).not.toHaveBeenCalled();
  });

  it("a valid pair reaches the domain as cents; blank clears", async () => {
    await setJobRepairCostsAction("j-1", { partsCostDollars: "", laborCostDollars: "45.50" });
    expect(m.set).toHaveBeenCalledWith("owner-1", "j-1", { partsCostCents: null, laborCostCents: 4550 });
  });

  it.each([-1, 1.5, Number.NaN, 10_000_001])(
    "a direct domain call with %s is rejected before touching the database",
    async (bad) => {
      const actual = await vi.importActual<typeof import("@/domains/jobs")>("@/domains/jobs");
      await expect(
        actual.setJobRepairCosts("owner-1", "j-1", { partsCostCents: null, laborCostCents: bad }),
      ).rejects.toThrow(/Labor cost must be/);
    },
  );
});
