import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ limited: false, keys: [] as string[], saved: 0, lookups: [] as Array<{ address: unknown; keep: unknown }> }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async (key: string) => { state.keys.push(key); return state.limited; } }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: async () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => () => { state.saved += 1; } }) }));
// ZONE-1: the Census lookup answers from fixed town centers by ZIP (no network in tests).
vi.mock("@/domains/delivery/geocode", () => ({
  geocodeAddress: async (address: { zip: string }, options: { keep?: boolean }) => {
    state.lookups.push({ address, keep: options?.keep });
    const points: Record<string, { lat: number; lon: number }> = { "80634": { lat: 40.41, lon: -104.77 }, "80537": { lat: 40.398, lon: -105.075 }, "80202": { lat: 39.75, lon: -104.99 }, "80401": { lat: 39.755, lon: -105.221 } };
    const point = points[address.zip];
    return point ? { status: "FOUND", point, state: "CO", zip: address.zip } : { status: "UNAVAILABLE" };
  },
}));

import { checkServiceAddress } from "@/app/(public)/check-address-actions";

const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };
const idle = { status: "idle" } as const;

beforeEach(() => { state.limited = false; state.keys = []; state.saved = 0; state.lookups = []; });

describe("the address check (delivery zones)", () => {
  it("answers with the zone from the address and echoes only what the visitor typed", async () => {
    expect(await checkServiceAddress(idle, form({ line1: " 1  Main St ", zip: "80634" })))
      .toEqual({ status: "SERVED", zip: "80634", line1: "1 Main St", zone: "Local — free delivery", free: true, price: null });
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80537" }))).toMatchObject({ status: "SERVED", zone: "Nearby", price: null });
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80401" }))).toMatchObject({ status: "OUTSIDE", zip: "80401" });
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80999" }))).toMatchObject({ status: "UNKNOWN" });
    expect(await checkServiceAddress(idle, form({ line1: "", zip: "80634" }))).toEqual({ status: "INVALID" });
    // Public checks are never kept, not even in memory.
    expect(state.lookups.every((row) => row.keep === false)).toBe(true);
  });
  it("is limited per visitor with the shared limiter, using only the first forwarded address", async () => {
    state.limited = true;
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80634" }))).toEqual({ status: "LIMITED" });
    expect(state.keys).toEqual(["address-check:203.0.113.9"]);
    expect(state.lookups).toEqual([]);
  });
  it("ignores the hidden anti-spam field when filled, and never writes anything to the database", async () => {
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80634", website: "http://spam" }))).toEqual({ status: "INVALID" });
    await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80634" }));
    expect(state.saved).toBe(0);
  });
  it("does not write the address to the log and never returns a position or miles", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const answer = await checkServiceAddress(idle, form({ line1: "77 Secret Lane", zip: "80634" }));
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    expect(JSON.stringify(answer)).not.toMatch(/40\.41|104\.77|miles/);
    spies.forEach((s) => s.mockRestore());
  });
});
