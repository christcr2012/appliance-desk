import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  guard: vi.fn(),
  update: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/domains/settings", () => ({ updateBusinessSettings: m.update }));
vi.mock("@/domains/staff", () => ({}));
vi.mock("@/domains/pricing", () => ({
  dollarsToCents: (v: number) => Math.round(v * 100),
}));
import { updateSettingsSectionAction } from "@/app/desk/settings/actions";
const base = {
  publicBusinessName: "Business",
  publicPhone: "9705550100",
  publicEmail: "support@example.test",
  publicAddress: "Business address",
};
const none = { mode: "none", open: "09:00", close: "17:00" };
const profile = {
  ...base,
  hours: { mon: none, tue: none, wed: none, thu: none, fri: none, sat: none, sun: none },
  holidayClosuresText: "",
  facebookUrl: "",
  instagramUrl: "",
  googleUrl: "",
  nextdoorUrl: "",
  logoUrl: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ user: { id: "owner" } });
  m.update.mockResolvedValue({});
});
it("writes only selected fields through existing audited domain and revalidates public content", async () => {
  expect(
    await updateSettingsSectionAction("profile", {
      ...profile,
      deliveryFeeDollars: 999,
    }),
  ).toEqual({ status: "success" });
  expect(m.update).toHaveBeenCalledWith("owner", {
    ...base,
    hours: {},
    holidayClosures: [],
    socialLinks: {},
    logoUrl: null,
  });
  expect(m.revalidate).toHaveBeenCalledWith("/", "layout");
});
it("rejects unauthorized calls before writes", async () => {
  m.guard.mockRejectedValue(new Error("denied"));
  await expect(updateSettingsSectionAction("profile", profile)).rejects.toThrow(
    "denied",
  );
  expect(m.update).not.toHaveBeenCalled();
});
it("returns a failed save, never success, when the transaction fails", async () => {
  m.update.mockRejectedValue(new Error("private internal error"));
  expect(await updateSettingsSectionAction("profile", profile)).toMatchObject({
    status: "error",
    message: expect.stringContaining("could not be saved"),
  });
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("invalid inputs never reach storage", async () => {
  expect(await updateSettingsSectionAction("profile", {})).toMatchObject({
    status: "error",
  });
  expect(m.update).not.toHaveBeenCalled();
});
