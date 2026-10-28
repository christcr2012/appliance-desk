// AR-8 (SETTINGS spec section 6): getSettingsPage on real Postgres —
// role-shaped rows, display text, revisions, last-change from the audit
// walk, and the AR-12 feature filter.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "", role: "OWNER" as string }));
vi.mock("@/lib/session", () => ({
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(session.role)) throw new Error("Not allowed");
    return { user: { id: session.userId, role: session.role } };
  },
}));

import { prisma } from "@/lib/prisma";
import { getSettingsPage } from "@/domains/settings/page-data";
import { getBusinessSettings, updateBusinessSettings } from "@/domains/settings";
import { fieldsRevision } from "@/domains/settings/preview";

const target = (() => { try { return new URL(process.env.DATABASE_URL ?? ""); } catch { return null; } })();
const enabled = process.env.CI === "true" && !!target && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("AR-8 settings page data on real Postgres", () => {
  let ownerId = "";
  let adminId = "";
  let shownBefore: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    ownerId = owner.id;
    adminId = admin.id;
    session.userId = ownerId;
    shownBefore = (await getBusinessSettings()).shownFeatures ?? [];
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shownFeatures: shownBefore } });
  });

  it("shapes the rentals rows for the owner: display, revision, editable", async () => {
    const page = await getSettingsPage("rentals");
    const relocation = page.rows.find((r) => r.def.key === "relocationFeeCents");
    expect(relocation).toBeTruthy();
    expect(relocation!.display).toBe("$75.00");
    const stored = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(relocation!.revision).toBe(fieldsRevision(stored, ["relocationFeeCents"]));
    expect(relocation!.editable).toBe(true);
    // The delivery window hours display as clock times.
    const morning = page.rows.find((r) => r.def.key === "deliveryMorningStartHour");
    expect(morning!.display).toBe("8 am");
  });

  it("finds the last change from the audit walk", async () => {
    await updateBusinessSettings(ownerId, { relocationFeeCents: 8100 });
    try {
      const page = await getSettingsPage("rentals");
      const relocation = page.rows.find((r) => r.def.key === "relocationFeeCents");
      expect(relocation!.display).toBe("$81.00");
      expect(relocation!.lastChange).not.toBeNull();
      expect(relocation!.lastChange!.at).toBeInstanceOf(Date);
    } finally {
      await updateBusinessSettings(ownerId, { relocationFeeCents: 7500 });
    }
  });

  it("marks owner-only rows read-only for an admin and refuses staff", async () => {
    session.userId = adminId;
    session.role = "ADMIN";
    try {
      const page = await getSettingsPage("team");
      const trusted = page.rows.find((r) => r.def.key === "trustedDeviceDays");
      expect(trusted!.editable).toBe(false);
      const team = page.rows.find((r) => r.def.key === "teamPanel");
      expect(team!.editable).toBe(true);
    } finally {
      session.userId = ownerId;
      session.role = "OWNER";
    }
    session.role = "STAFF";
    try {
      await expect(getSettingsPage("team")).rejects.toThrow("Not allowed");
    } finally {
      session.role = "OWNER";
    }
  });

  it("hides a feature-gated row until the feature is shown", async () => {
    const before = await getSettingsPage("money");
    const exportsRow = before.rows.find((r) => r.def.key === "exportPayoutLines");
    const storedFeatures = (await getBusinessSettings()).shownFeatures ?? [];
    const wasShown = storedFeatures.includes("accountantExports");
    expect(Boolean(exportsRow)).toBe(wasShown);
    if (!wasShown) {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { shownFeatures: [...storedFeatures, "accountantExports"] },
      });
      const after = await getSettingsPage("money");
      expect(after.rows.some((r) => r.def.key === "exportPayoutLines")).toBe(true);
    }
  });
});
