import { describe, it, expect, vi, beforeEach } from "vitest";

// Global desk search (/desk/search, src/domains/search/index.ts) — looks
// across customers, appliances, and leads at once. These tests check the
// empty-query short-circuit (no reason to run three findMany calls for
// nothing) and that a real query shapes each result the page expects.

const customerFindMany = vi.fn();
const applianceFindMany = vi.fn();
const leadFindMany = vi.fn();

vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findMany: (...args: unknown[]) => customerFindMany(...args) },
    appliance: { findMany: (...args: unknown[]) => applianceFindMany(...args) },
    lead: { findMany: (...args: unknown[]) => leadFindMany(...args) },
  },
}));

import { searchAll } from "@/domains/search";
import { requireRole } from "@/lib/session";

describe("searchAll", () => {
  it("rejects unauthorized callers before any search query", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("unauthorized"));
    await expect(searchAll("customer")).rejects.toThrow("unauthorized");
    expect(customerFindMany).not.toHaveBeenCalled();
    expect(applianceFindMany).not.toHaveBeenCalled();
    expect(leadFindMany).not.toHaveBeenCalled();
  });
  it("selects only fields in the search DTO", async () => {
    await searchAll("customer");
    expect(customerFindMany.mock.calls[0][0].select).toEqual({ id: true, companyName: true,
      user: { select: { name: true, email: true } } });
    expect(applianceFindMany.mock.calls[0][0].select).toEqual({ id: true, assetNumber: true, manufacturer: true,
      applianceType: { select: { name: true } } });
    expect(leadFindMany.mock.calls[0][0].select).toEqual({ id: true, contactName: true, email: true, status: true });
  });
  beforeEach(() => {
    customerFindMany.mockReset().mockResolvedValue([]);
    applianceFindMany.mockReset().mockResolvedValue([]);
    leadFindMany.mockReset().mockResolvedValue([]);
  });

  it("short-circuits on a blank query without touching the database", async () => {
    const result = await searchAll("   ");
    expect(result).toEqual({ query: "", customers: [], appliances: [], leads: [] });
    expect(customerFindMany).not.toHaveBeenCalled();
    expect(applianceFindMany).not.toHaveBeenCalled();
    expect(leadFindMany).not.toHaveBeenCalled();
  });

  it("trims the query before searching and echoes it back", async () => {
    await searchAll("  Whirlpool  ");
    expect(customerFindMany).toHaveBeenCalledTimes(1);
    const result = await searchAll("  Whirlpool  ");
    expect(result.query).toBe("Whirlpool");
  });

  it("only searches non-archived customers", async () => {
    await searchAll("pat");
    const args = customerFindMany.mock.calls[0][0];
    expect(args.where.archivedAt).toBeNull();
  });

  it("maps a matched customer to the shape the search page expects", async () => {
    customerFindMany.mockResolvedValue([
      {
        id: "cust-1",
        companyName: "Pat Properties LLC",
        user: { name: "Pat Landlord", email: "pat@example.com" },
      },
    ]);
    const result = await searchAll("pat");
    expect(result.customers).toEqual([
      { id: "cust-1", name: "Pat Landlord", email: "pat@example.com", companyName: "Pat Properties LLC" },
    ]);
  });

  it("maps a matched appliance to the shape the search page expects", async () => {
    applianceFindMany.mockResolvedValue([
      {
        id: "app-1",
        assetNumber: "WASH-0001",
        manufacturer: "Whirlpool",
        applianceType: { name: "Washer" },
      },
    ]);
    const result = await searchAll("wash");
    expect(result.appliances).toEqual([
      { id: "app-1", assetNumber: "WASH-0001", typeName: "Washer", manufacturer: "Whirlpool" },
    ]);
  });

  it("maps a matched lead to the shape the search page expects", async () => {
    leadFindMany.mockResolvedValue([
      { id: "lead-1", contactName: "Sam Renter", email: "sam@example.com", status: "NEW" },
    ]);
    const result = await searchAll("sam");
    expect(result.leads).toEqual([
      { id: "lead-1", contactName: "Sam Renter", email: "sam@example.com", status: "NEW" },
    ]);
  });
});
