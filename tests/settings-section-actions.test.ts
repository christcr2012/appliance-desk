import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  guard: vi.fn(),
  update: vi.fn(),
  revalidate: vi.fn(),
  findSettings: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { businessSettings: { findUnique: m.findSettings } } }));
vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/domains/settings", () => ({ updateBusinessSettings: m.update }));
vi.mock("@/domains/staff", () => ({}));
vi.mock("@/domains/pricing", () => ({
  dollarsToCents: (v: number) => Math.round(v * 100),
}));
import { updateSettingsSectionAction, previewSettingsSectionAction } from "@/app/desk/settings/actions";
import { SettingsConflictError } from "@/domains/settings/effects";
import { sectionRevision } from "@/domains/settings/preview";
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
  m.findSettings.mockResolvedValue({ publicBusinessName: "Business", publicPhone: "9705550100", publicEmail: "support@example.test", publicAddress: "Old address" });
});
it("writes only selected fields through existing audited domain and revalidates public content", async () => {
  expect(
    await updateSettingsSectionAction("profile", {
      ...profile,
      deliveryFeeDollars: 999,
    }),
  ).toMatchObject({ status: "success", revision: sectionRevision(await m.findSettings(), "profile") });
  expect(m.update).toHaveBeenCalledWith("owner", {
    ...base,
    hours: {},
    holidayClosures: [],
    socialLinks: {},
    logoUrl: null,
  }, undefined);
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

it("passes the page's fingerprint to the save so an out-of-date page is checked inside the transaction", async () => {
  await updateSettingsSectionAction("profile", profile, "abc123");
  expect(m.update).toHaveBeenCalledWith("owner", expect.anything(), { expectedRevision: { section: "profile", value: "abc123" } });
});
it("tells the person to reload, and saves nothing, when somebody else changed these settings", async () => {
  m.update.mockRejectedValue(new SettingsConflictError());
  expect(await updateSettingsSectionAction("profile", profile, "abc123")).toEqual({
    status: "error",
    message: expect.stringContaining("Reload the page"),
  });
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("previews a section save without writing anything", async () => {
  const result = await previewSettingsSectionAction("profile", profile);
  expect(result).toMatchObject({ status: "preview", nothingToSave: false });
  if (result.status === "preview") expect(result.lines.map((l) => l.label)).toContain("Public address");
  expect(m.update).not.toHaveBeenCalled();
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("refuses a preview for someone without the role, and for bad input", async () => {
  expect(await previewSettingsSectionAction("profile", {})).toMatchObject({ status: "error" });
  m.guard.mockRejectedValue(new Error("denied"));
  await expect(previewSettingsSectionAction("profile", profile)).rejects.toThrow("denied");
});
