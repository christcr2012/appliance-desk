import { describe, it, expect, vi, beforeEach } from "vitest";
const { join, limited, requireRole, upsert, suppress } = vi.hoisted(() => ({
  join: vi.fn(),
  limited: vi.fn(),
  requireRole: vi.fn(),
  upsert: vi.fn(),
  suppress: vi.fn(),
}));
vi.mock("@/domains/launch", () => ({ joinLaunchList: join }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: limited }));
vi.mock("@/lib/session", () => ({ requireRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    launchSettings: { upsert },
    launchSubscriber: { update: suppress },
  },
}));
import { submitLaunchSignup } from "@/app/(public)/launch/actions";
import {
  saveLaunchSettings,
  suppressLaunchSubscriber,
} from "@/app/desk/launch/actions";

function form() {
  const f = new FormData();
  Object.entries({
    name: "Test Person",
    email: "test@example.test",
    city: "Greeley",
    interest: "Washer",
    consent: "on",
  }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  limited.mockReturnValue(false);
  join.mockResolvedValue(undefined);
});
describe("public signup protection", () => {
  it("rejects missing consent and rate-limited signups before saving", async () => {
    const f = form();
    f.delete("consent");
    expect(
      (await submitLaunchSignup({ status: "idle" }, f)).errors?.consent,
    ).toBeDefined();
    limited.mockReturnValue(true);
    expect((await submitLaunchSignup({ status: "idle" }, form())).status).toBe(
      "error",
    );
    expect(join).not.toHaveBeenCalled();
  });
  it("silently drops honeypot submissions, reports storage failures honestly", async () => {
    const f = form();
    f.set("website", "spam");
    expect((await submitLaunchSignup({ status: "idle" }, f)).status).toBe(
      "success",
    );
    expect(join).not.toHaveBeenCalled();
    join.mockRejectedValue(new Error("database offline"));
    expect((await submitLaunchSignup({ status: "idle" }, form())).status).toBe(
      "error",
    );
  });
  it("requires owner/admin authorization inside both management actions", async () => {
    requireRole.mockRejectedValue(new Error("denied"));
    await expect(
      saveLaunchSettings({ status: "idle" }, form()),
    ).rejects.toThrow("denied");
    await expect(suppressLaunchSubscriber(form())).rejects.toThrow("denied");
    expect(requireRole).toHaveBeenCalledWith("OWNER", "ADMIN");
    expect(upsert).not.toHaveBeenCalled();
    expect(suppress).not.toHaveBeenCalled();
  });
});
