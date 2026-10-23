import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_ACTIONS, OWNER_ACTION_GROUPS, searchOwnerActions, visibleOwnerActions } from "@/lib/owner-actions";
import { CAPABILITY_KEYS } from "@/domains/capabilities";

function pageFileFor(href: string): string | null {
  const route = href.split("?")[0].split("#")[0];
  const file = path.join(process.cwd(), "src/app", route, "page.tsx");
  return existsSync(file) ? file : null;
}

describe("Manage my business registry", () => {
  it("has unique ids, known groups, known capabilities and plain text", () => {
    const ids = OWNER_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set<string>(OWNER_ACTION_GROUPS.map((g) => g.id));
    for (const a of OWNER_ACTIONS) {
      expect(groups.has(a.group), a.id).toBe(true);
      if (a.capability) expect(CAPABILITY_KEYS).toContain(a.capability);
      expect(a.label.length).toBeGreaterThan(3);
      expect(a.summary.endsWith(".")).toBe(true);
    }
    for (const g of OWNER_ACTION_GROUPS) expect(OWNER_ACTIONS.some((a) => a.group === g.id), g.id).toBe(true);
  });

  it("every card points at a real desk screen (no broken links)", () => {
    for (const a of OWNER_ACTIONS) {
      expect(a.href.startsWith("/desk/"), a.id).toBe(true);
      expect(pageFileFor(a.href), `${a.id} -> ${a.href}`).not.toBeNull();
    }
  });

  it("owner-only cards point at screens that really are owner-only, so the map never leads an admin to a wall", () => {
    for (const a of OWNER_ACTIONS) {
      const file = pageFileFor(a.href)!;
      const calls = [...readFileSync(file, "utf8").matchAll(/requireRole(?:ForTwoFactorSetup)?\(([^)]*)\)/g)].map((m) => m[1]);
      if (calls.length === 0) continue; // guarded another way (for example by the section it sits in)
      const roles = new Set(calls[0].match(/"(OWNER|ADMIN|STAFF)"/g)?.map((r) => r.replaceAll('"', "")));
      if (a.access === "owner") expect([...roles], `${a.id} should be owner-only`).toEqual(["OWNER"]);
      else expect(roles.has("OWNER") && roles.has("ADMIN"), `${a.id} should allow owner and admin`).toBe(true);
    }
  });
});

describe("who sees which cards", () => {
  it("admins never get owner-only cards in the data, staff and customers get nothing", () => {
    const owner = visibleOwnerActions("OWNER");
    const admin = visibleOwnerActions("ADMIN");
    expect(owner).toHaveLength(OWNER_ACTIONS.length);
    expect(admin.every((a) => a.access === "admin")).toBe(true);
    expect(admin.length).toBeLessThan(owner.length);
    expect(visibleOwnerActions("STAFF")).toEqual([]);
    expect(visibleOwnerActions("CUSTOMER")).toEqual([]);
    expect(visibleOwnerActions("")).toEqual([]);
  });
  it("a limited admin loses cards that need the taken-away permission; the owner never does", () => {
    const limited = visibleOwnerActions("ADMIN", ["EDIT_SETTINGS"]);
    expect(limited.some((a) => a.capability === "EDIT_SETTINGS")).toBe(false);
    expect(limited.some((a) => a.id === "website")).toBe(true);
    expect(visibleOwnerActions("OWNER", ["EDIT_SETTINGS"])).toHaveLength(OWNER_ACTIONS.length);
  });
});

describe("search by intention", () => {
  const all = visibleOwnerActions("OWNER");
  const top = (q: string) => searchOwnerActions(all, q)[0]?.id;
  it("finds the right screen from everyday words", () => {
    expect(top("change website picture")).toBe("website");
    expect(top("fix failed payment")).toBe("held-payments");
    expect(top("stop reminders")).toBe("notifications");
    expect(searchOwnerActions(all, "change rent").map((a) => a.id)).toContain("appliance-prices");
    expect(top("who changed what")).toBe("activity");
    expect(top("undo")).toBe("undo");
  });
  it("returns nothing for empty, junk or unmatched text, and caps the list", () => {
    expect(searchOwnerActions(all, "")).toEqual([]);
    expect(searchOwnerActions(all, "   ")).toEqual([]);
    expect(searchOwnerActions(all, "to the of")).toEqual([]);
    expect(searchOwnerActions(all, "zzzzqqq")).toEqual([]);
    expect(searchOwnerActions(all, "a".repeat(5000))).toEqual([]);
    expect(searchOwnerActions(all, "money").length).toBeLessThanOrEqual(12);
  });
  it("only searches the cards it is given (an admin cannot find an owner-only card)", () => {
    const admin = visibleOwnerActions("ADMIN");
    expect(searchOwnerActions(admin, "approval limits").some((a) => a.id === "approval-limits")).toBe(false);
    expect(searchOwnerActions(admin, "what each admin may do")).not.toContainEqual(expect.objectContaining({ id: "permissions" }));
  });
});
