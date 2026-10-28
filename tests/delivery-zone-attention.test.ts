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

  it("finds newer work behind more than 300 finished estimates (scans every page before limiting)", async () => {
    const done = (n: number) => estimate(`done-${String(n).padStart(4, "0")}`, "CONVERTED",
      [location({ choice: "CUSTOMER_PICKUP", pickupArranged: { userId: "u", note: "Done", at: at.toISOString() } })]);
    const page1 = Array.from({ length: 200 }, (_, i) => done(i));
    const page2 = [...Array.from({ length: 150 }, (_, i) => done(200 + i)),
      estimate("z-new-unknown", "SENT", [location({ zone: "UNKNOWN", priceCents: null, miles: null })]),
      estimate("z-new-pickup", "SENT", [location({ choice: "CUSTOMER_PICKUP" })])];
    mocks.findMany.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const result = await listDeliveryZoneAttention(50);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.findMany.mock.calls[1]![0]).toMatchObject({ cursor: { id: "done-0199" }, skip: 1, take: 200 });
    expect(result.unknown).toMatchObject({ total: 1, rows: [{ href: "/desk/estimates/z-new-unknown#delivery-zone" }] });
    expect(result.pickups).toMatchObject({ total: 1, rows: [{ href: "/desk/estimates/z-new-pickup#delivery-zone" }] });
  });

  it("asks for a new quote when pickup was chosen on a quote that charged delivery", async () => {
    mocks.findMany.mockResolvedValue([
      estimate("r1", "CHANGES_REQUESTED", [location({ choice: "CUSTOMER_PICKUP", requote: { at: at.toISOString(), by: "CUSTOMER" } })]),
      estimate("r2", "SENT", [location({ choice: "CUSTOMER_PICKUP", requote: { at: at.toISOString(), by: "CUSTOMER" } })]),
    ]);
    const result = await listDeliveryZoneAttention(50);
    expect(result.requotes.rows.map((row) => row.title)).toEqual(["Send a new quote without delivery to Maria Lopez"]);
    expect(result.pickups.rows.map((row) => row.href)).toEqual(["/desk/estimates/r2#delivery-zone"]);
  });

  it("is owner/admin only and bounded", async () => {
    mocks.requireRole.mockRejectedValue(new Error("unauthorized"));
    await expect(listDeliveryZoneAttention(50)).rejects.toThrow("unauthorized");
    expect(mocks.findMany).not.toHaveBeenCalled();
    mocks.requireRole.mockResolvedValue({ user: { role: "ADMIN" } });
    await expect(listDeliveryZoneAttention(51)).rejects.toThrow(/bounded/);
  });
});
