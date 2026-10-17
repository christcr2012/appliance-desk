import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ limited: false, keys: [] as string[], saved: 0 }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async (key: string) => { state.keys.push(key); return state.limited; } }));
vi.mock("@/domains/settings", () => ({
  getBusinessSettings: async () => ({ serviceAreaCities: ["Greeley"], serviceAreaZips: ["80634"] }),
  parseServiceArea: (s: { serviceAreaCities: string[]; serviceAreaZips: string[] }) => ({ cities: s.serviceAreaCities, zips: s.serviceAreaZips }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => () => { state.saved += 1; } }) }));

import { checkServiceAddress } from "@/app/(public)/check-address-actions";

const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };
const idle = { status: "idle" } as const;

beforeEach(() => { state.limited = false; state.keys = []; state.saved = 0; });

describe("the home page address check", () => {
  it("answers from the owner's service area and echoes only what the visitor typed", async () => {
    expect(await checkServiceAddress(idle, form({ line1: " 1  Main St ", zip: "80634" }))).toEqual({ status: "SERVED", zip: "80634", line1: "1 Main St" });
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80202" }))).toMatchObject({ status: "NOT_YET", zip: "80202" });
    expect(await checkServiceAddress(idle, form({ line1: "", zip: "80634" }))).toEqual({ status: "INVALID" });
  });
  it("is limited per visitor with the shared limiter, using only the first forwarded address", async () => {
    state.limited = true;
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80634" }))).toEqual({ status: "LIMITED" });
    expect(state.keys).toEqual(["address-check:203.0.113.9"]);
  });
  it("ignores the hidden anti-spam field when filled, and never writes anything to the database", async () => {
    expect(await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80634", website: "http://spam" }))).toEqual({ status: "INVALID" });
    await checkServiceAddress(idle, form({ line1: "1 Main St", zip: "80634" }));
    expect(state.saved).toBe(0);
  });
  it("does not write the address to the log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await checkServiceAddress(idle, form({ line1: "77 Secret Lane", zip: "80634" }));
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    spies.forEach((s) => s.mockRestore());
  });
});
