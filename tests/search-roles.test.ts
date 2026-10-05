import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  customers: vi.fn(),
  appliances: vi.fn(),
  leads: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findMany: (...args: unknown[]) => mocks.customers(...args) },
    appliance: { findMany: (...args: unknown[]) => mocks.appliances(...args) },
    lead: { findMany: (...args: unknown[]) => mocks.leads(...args) },
  },
}));

import { searchAll } from "@/domains/search";

describe("role-aware global search", () => {
  beforeEach(() => {
    mocks.customers.mockReset().mockResolvedValue([]);
    mocks.appliances.mockReset().mockResolvedValue([]);
    mocks.leads.mockReset().mockResolvedValue([
      { id: "lead-1", contactName: "Private Lead", email: "private@example.com", status: "NEW" },
    ]);
  });

  it("STAFF never queries or returns leads", async () => {
    mocks.requireRole.mockResolvedValue({ user: { role: "STAFF" } });
    const result = await searchAll("private");
    expect(mocks.leads).not.toHaveBeenCalled();
    expect(result.leads).toEqual([]);
    expect(JSON.stringify(result.leads)).not.toMatch(/email|phone|scoreReasons/);
  });

  it.each(["OWNER", "ADMIN"] as const)("%s retains lead search", async (role) => {
    mocks.requireRole.mockResolvedValue({ user: { role } });
    const result = await searchAll("private");
    expect(mocks.leads).toHaveBeenCalledTimes(1);
    expect(result.leads).toEqual([
      { id: "lead-1", contactName: "Private Lead", email: "private@example.com", status: "NEW" },
    ]);
  });

  it("authorization still happens before every database read", async () => {
    mocks.requireRole.mockRejectedValue(new Error("unauthorized"));
    await expect(searchAll("private")).rejects.toThrow("unauthorized");
    expect(mocks.customers).not.toHaveBeenCalled();
    expect(mocks.appliances).not.toHaveBeenCalled();
    expect(mocks.leads).not.toHaveBeenCalled();
  });
});
