import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), requireRole: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { estimate: { findMany: mocks.findMany } } }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
import { listDeliveryZoneAttention } from "@/domains/exceptions/delivery-zone-attention";

const at = new Date("2026-10-26T15:00:00Z");
const location = (over: Record<string, unknown>) => ({ serviceAddressId: "a1", zone: 2, name: "Nearby", miles: 20, method: "STRAIGHT_LINE",
  center: { lat: 40.4233, lon: -104.7091 }, priceCents: 7500, pickupPriceCents: 7500, choice: "DELIVER", checkedAt: at.toISOString(), ...over });
const estimate = (id: string, status: string, locations: unknown[]) => ({
  id, status, estimateNumber: 7, updatedAt: at, deliveryZoneSnapshotAt: at,
  deliveryZoneSnapshot: { version: 1, locations },
  customer: { companyName: null, user: { name: "Maria Lopez", email: "m@example.test" } }, lead: null,
  lineItems: [{ serviceAddress: { id: "a1", line1: "1 Main St", city: "Evans" } }],
});

beforeEach(() => { mocks.findMany.mockReset(); mocks.requireRole.mockReset().mockResolvedValue({ user: { role: "OWNER" } }); });

describe("ZONE-1 To do items", () => {
  it("asks to confirm an unknown zone and to arrange a customer pickup, linking to the estimate", async () => {
    mocks.findMany.mockResolvedValue([
      estimate("e1", "SENT", [location({ zone: "UNKNOWN", priceCents: null, miles: null })]),
      estimate("e2", "APPROVED", [location({ choice: "CUSTOMER_PICKUP" })]),
      estimate("e3", "SENT", [location({ choice: "CUSTOMER_PICKUP", pickupArranged: { userId: "u", note: "Sat 10am", at: at.toISOString() } })]),
      estimate("e4", "CONVERTED", [location({ zone: "UNKNOWN", priceCents: null })]),
    ]);
    const result = await listDeliveryZoneAttention(50);
    expect(result.unknown.rows.map((row) => [row.title, row.href])).toEqual([
      ["Confirm the delivery zone for 1 Main St, Evans", "/desk/estimates/e1#delivery-zone"],
    ]);
    expect(result.pickups.rows.map((row) => [row.title, row.href])).toEqual([
      ["Arrange pickup with Maria Lopez", "/desk/estimates/e2#delivery-zone"],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/40\.42|104\.70/);
  });

  it("is owner/admin only and bounded", async () => {
    mocks.requireRole.mockRejectedValue(new Error("unauthorized"));
    await expect(listDeliveryZoneAttention(50)).rejects.toThrow("unauthorized");
    expect(mocks.findMany).not.toHaveBeenCalled();
    mocks.requireRole.mockResolvedValue({ user: { role: "ADMIN" } });
    await expect(listDeliveryZoneAttention(51)).rejects.toThrow(/bounded/);
  });
});
