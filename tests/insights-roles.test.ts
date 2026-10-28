import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
const roleState = vi.hoisted(() => ({ role: "OWNER" as string }));
const navState = vi.hoisted(() => ({ target: "" as string }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    navState.target = url;
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!roles.includes(roleState.role)) {
      throw new Error(`Role ${roleState.role} is not allowed here.`);
    }
    return { user: { id: "insights-role-fixture", role: roleState.role } };
  }),
}));
import { getCustomerInsights, getLeadInsights, getWorthACall } from "@/domains/insights/customers";
import { getEquipmentInsights } from "@/domains/insights/equipment";
import { getRentHealth } from "@/domains/insights/money";

// AR-9 (INSIGHTS roles): every insights function refuses STAFF itself; the
// underlying growth/reports reads stay session-free for To do and cron.
let parsed: URL | null = null;
try { parsed = new URL(process.env.DATABASE_URL ?? ""); } catch { parsed = null; }
const enabled =
  process.env.CI === "true" && parsed !== null &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("insights roles (AR-9)", () => {
  const fns: Array<[string, () => Promise<unknown>]> = [
    ["getLeadInsights", () => getLeadInsights()],
    ["getCustomerInsights", () => getCustomerInsights()],
    ["getWorthACall", () => getWorthACall()],
    ["getEquipmentInsights", () => getEquipmentInsights()],
    ["getRentHealth", () => getRentHealth()],
  ];

  it("STAFF is refused by every insights function", async () => {
    roleState.role = "STAFF";
    for (const [name, fn] of fns) {
      await expect(fn(), name).rejects.toThrow(/not allowed/);
    }
  });

  it("CUSTOMER is refused by every insights function", async () => {
    roleState.role = "CUSTOMER";
    for (const [name, fn] of fns) {
      await expect(fn(), name).rejects.toThrow(/not allowed/);
    }
  });

  it("OWNER and ADMIN are allowed", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      roleState.role = role;
      for (const [name, fn] of fns) {
        await expect(fn(), name).resolves.toBeDefined();
      }
    }
  });
});

describe("insights redirects and route shape (AR-9)", () => {
  it("the old pages redirect to the new homes, keeping their params", async () => {
    const { default: GrowthRedirect } = await import("@/app/desk/growth/page");
    const { default: ReportsRedirect } = await import("@/app/desk/reports/page");
    const { default: DashboardRedirect } = await import("@/app/desk/dashboard/page");
    const { default: FleetRedirect } = await import("@/app/desk/fleet/page");
    const { default: RevenueRedirect } = await import("@/app/desk/revenue/page");
    expect(() => GrowthRedirect()).toThrow("NEXT_REDIRECT");
    expect(navState.target).toBe("/desk/customers/insights");
    expect(() => ReportsRedirect()).toThrow("NEXT_REDIRECT");
    expect(navState.target).toBe("/desk/money");
    expect(() => DashboardRedirect()).toThrow("NEXT_REDIRECT");
    expect(navState.target).toBe("/desk/today");
    await expect(FleetRedirect({ searchParams: Promise.resolve({ page: "3", costs: "missing" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(navState.target).toBe("/desk/inventory/insights?page=3&costs=missing");
    await expect(RevenueRedirect({ searchParams: Promise.resolve({ source: "refunds", scope: "all" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(navState.target).toBe("/desk/money/income?source=refunds&scope=all");
  });

  it("the static insights segments exist beside the [id] routes", () => {
    const root = process.cwd();
    // A static segment wins over the dynamic [id] segment in the App Router,
    // so /desk/customers/insights renders Insights, not a customer lookup.
    expect(existsSync(join(root, "src/app/desk/customers/insights/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/app/desk/customers/[id]/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/app/desk/inventory/insights/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "src/app/desk/inventory/[id]/page.tsx"))).toBe(true);
  });
});
