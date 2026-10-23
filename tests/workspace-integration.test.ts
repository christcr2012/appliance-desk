import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { setAdminCapability } from "@/domains/capabilities";
import {
  addSavedView, getWorkspace, pinAction, removeSavedView, setOptionalCardHidden, unpinAction, MAX_PINNED,
} from "@/domains/workspace";
import { OWNER_ACTIONS } from "@/lib/owner-actions";

// Batch O-7 on real Postgres: private per-person rows, compare-and-set saves, role and permission checks.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("owner workspace on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const adminA = `ws-admin-a-${tag}`;
  const adminB = `ws-admin-b-${tag}`;
  const staffId = `ws-staff-${tag}`;
  const customerId = `ws-cust-${tag}`;
  let ownerId: string;
  const ids = [adminA, adminB, staffId, customerId];

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.createMany({ data: [
      { id: adminA, name: "WS Admin A", email: `${tag}-a@example.test`, role: "ADMIN", emailVerified: true },
      { id: adminB, name: "WS Admin B", email: `${tag}-b@example.test`, role: "ADMIN", emailVerified: true },
      { id: staffId, name: "WS Staff", email: `${tag}-s@example.test`, role: "STAFF", emailVerified: true },
      { id: customerId, name: "WS Customer", email: `${tag}-c@example.test`, role: "CUSTOMER", emailVerified: true },
    ] });
  });
  afterAll(async () => {
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: { in: ids } } });
    await prisma.ownerWorkspacePreference.deleteMany({ where: { userId: { in: [...ids, ownerId] } } }); // owner row only exists if this test made it
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("starts empty without a row, then pins, unpins and keeps versions moving", async () => {
    const empty = await getWorkspace(adminA);
    expect(empty).toEqual({ version: 1, prefs: { pinnedActionIds: [], hiddenOptionalCardIds: [], savedViews: [] } });
    await pinAction(adminA, 1, "website");
    await pinAction(adminA, 2, "customers");
    await pinAction(adminA, 3, "customers"); // pinning twice changes nothing
    const now = await getWorkspace(adminA);
    expect(now.prefs.pinnedActionIds).toEqual(["website", "customers"]);
    expect(now.version).toBe(4);
    await unpinAction(adminA, 4, "website");
    expect((await getWorkspace(adminA)).prefs.pinnedActionIds).toEqual(["customers"]);
  });

  it("a stale save is refused, and two saves racing on the same version let exactly one win", async () => {
    const { version } = await getWorkspace(adminB);
    const results = await Promise.allSettled([pinAction(adminB, version, "website"), pinAction(adminB, version, "customers")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason.message)).toMatch(/another window/);
    await expect(pinAction(adminB, version, "leads")).rejects.toThrow(/another window/);
    expect((await getWorkspace(adminB)).prefs.pinnedActionIds).toHaveLength(1);
  });

  it("people only ever change their own row", async () => {
    const a = await getWorkspace(adminA);
    const b = await getWorkspace(adminB);
    await pinAction(adminB, b.version, "suppliers");
    expect((await getWorkspace(adminA)).prefs.pinnedActionIds).toEqual(a.prefs.pinnedActionIds);
  });

  it("staff and customers cannot use it at all", async () => {
    await expect(pinAction(staffId, 1, "website")).rejects.toThrow();
    await expect(pinAction(customerId, 1, "website")).rejects.toThrow();
    await expect(pinAction(`ws-nobody-${tag}`, 1, "website")).rejects.toThrow();
    expect(await prisma.ownerWorkspacePreference.count({ where: { userId: { in: [staffId, customerId] } } })).toBe(0);
  });

  it("an admin cannot pin an owner-only shortcut, or one the owner took away", async () => {
    const v = (await getWorkspace(adminA)).version;
    await expect(pinAction(adminA, v, "permissions")).rejects.toThrow(/not available/);
    await expect(pinAction(adminA, v, "no-such-card")).rejects.toThrow(/not available/);
    await setAdminCapability(ownerId, adminA, "EDIT_SETTINGS", false);
    await expect(pinAction(adminA, v, "business-profile")).rejects.toThrow(/not available/);
    await setAdminCapability(ownerId, adminA, "EDIT_SETTINGS", true);
    await pinAction(adminA, v, "business-profile");
  });

  it("allows at most 12 pins", async () => {
    const pinnable = OWNER_ACTIONS.filter((a) => a.access === "admin" && !a.capability).map((a) => a.id);
    expect(pinnable.length).toBeGreaterThan(MAX_PINNED);
    for (const id of pinnable.slice(0, 14)) {
      const { version, prefs } = await getWorkspace(adminB);
      if (prefs.pinnedActionIds.includes(id)) continue;
      if (prefs.pinnedActionIds.length >= MAX_PINNED) {
        await expect(pinAction(adminB, version, id)).rejects.toThrow(/up to 12/);
        break;
      }
      await pinAction(adminB, version, id);
    }
    expect((await getWorkspace(adminB)).prefs.pinnedActionIds).toHaveLength(MAX_PINNED);
  });

  it("only optional Today notes can be hidden", async () => {
    let w = await getWorkspace(adminA);
    await setOptionalCardHidden(adminA, w.version, "GOAL_BEHIND", true);
    w = await getWorkspace(adminA);
    expect(w.prefs.hiddenOptionalCardIds).toEqual(["GOAL_BEHIND"]);
    await expect(setOptionalCardHidden(adminA, w.version, "APPROVAL_REQUEST", true)).rejects.toThrow(/Important items always show/);
    await expect(setOptionalCardHidden(adminA, w.version, "OVERDUE_INVOICE", true)).rejects.toThrow();
    await setOptionalCardHidden(adminA, w.version, "GOAL_BEHIND", false);
    expect((await getWorkspace(adminA)).prefs.hiddenOptionalCardIds).toEqual([]);
  });

  it("saved views: add, list, remove; malformed filters and screens are refused", async () => {
    let w = await getWorkspace(adminA);
    await addSavedView(adminA, w.version, { label: "  Rented   out ", routeKey: "inventory", filters: { status: "RENTED" } });
    w = await getWorkspace(adminA);
    expect(w.prefs.savedViews).toHaveLength(1);
    expect(w.prefs.savedViews[0]).toMatchObject({ label: "Rented out", routeKey: "inventory", filters: { status: "RENTED" } });
    for (const bad of [
      { label: "x", routeKey: "billing", filters: { status: "RENTED" } },
      { label: "x", routeKey: "inventory", filters: { search: "Jane" } },
      { label: "x", routeKey: "inventory", filters: { status: "'; DROP TABLE" } },
      { label: "", routeKey: "inventory", filters: { status: "RENTED" } },
      { label: "x", routeKey: "inventory", filters: {} },
    ]) await expect(addSavedView(adminA, w.version, bad)).rejects.toThrow();
    await removeSavedView(adminA, w.version, w.prefs.savedViews[0].id);
    expect((await getWorkspace(adminA)).prefs.savedViews).toEqual([]);
  });

  it("an unreadable stored row never breaks reading, and deleting the account deletes the row", async () => {
    await prisma.$executeRaw`UPDATE "OwnerWorkspacePreference" SET "preferences" = '"garbage"'::jsonb WHERE "userId" = ${adminB}`;
    expect((await getWorkspace(adminB)).prefs).toEqual({ pinnedActionIds: [], hiddenOptionalCardIds: [], savedViews: [] });
    await prisma.user.delete({ where: { id: adminB } });
    expect(await prisma.ownerWorkspacePreference.count({ where: { userId: adminB } })).toBe(0);
  });
});
