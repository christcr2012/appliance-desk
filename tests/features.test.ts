import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FEATURES, FEATURE_KEYS, automaticFeatureReasons, isFeatureKey, isHrefHidden, savedFeatureKeys, shownFeatureKeys,
} from "@/domains/features/registry";
import { deskNavigation, deskMoreLinks } from "@/lib/desk-navigation";
import { practiceAppUrl } from "@/domains/features/practice";

describe("AR-12 feature visibility (navigation only)", () => {
  it("has exactly the seven approved keys and refuses unknown persisted values", () => {
    expect(FEATURE_KEYS).toEqual(["team", "propertyManagers", "budget", "accountantExports", "bankStatements", "spanishDocuments", "phoneCosts"]);
    expect(Object.keys(FEATURES)).toEqual([...FEATURE_KEYS]);
    expect(isFeatureKey("team")).toBe(true);
    expect(isFeatureKey("foo")).toBe(false);
    expect([...savedFeatureKeys(["budget", "budget", "bad", "bankStatements"])]).toEqual(["budget", "bankStatements"]);
  });

  it("only unlocks the three approved automatic features when actually in use", () => {
    expect([...automaticFeatureReasons({ activeTeam: 1, hasPropertyManager: false, cashBudgetEnabled: false }).keys()]).toEqual([]);
    const automatic = automaticFeatureReasons({ activeTeam: 2, hasPropertyManager: true, cashBudgetEnabled: true });
    expect([...automatic.keys()]).toEqual(["team", "propertyManagers", "budget"]);
    expect(automatic.get("budget")).toMatch(/already use/);
    expect(shownFeatureKeys(["phoneCosts"], automatic)).toEqual(new Set(["phoneCosts", "team", "propertyManagers", "budget"]));
  });

  it("hides exact path prefixes, respects segments and protects direct URLs", () => {
    const hidden = new Set<never>();
    expect(isHrefHidden("/desk/books/cash?tab=bank", hidden)).toBe(true);
    expect(isHrefHidden("/desk/books/cashier", hidden)).toBe(false);
    expect(isHrefHidden("/desk/customers/abc/locations", hidden)).toBe(true);
    expect(isHrefHidden("/desk/customers/abc/locations/one", hidden)).toBe(true);
    expect(isHrefHidden("/desk/customers/abc/locations-other", hidden)).toBe(false);
    expect(isHrefHidden("/desk/customers/locations", hidden)).toBe(false);
    expect(isHrefHidden("/desk/settings/telecom", hidden)).toBe(true);
    expect(isHrefHidden("/desk/settings/telecom", new Set(["phoneCosts"] as const))).toBe(false);
    expect(isHrefHidden("/desk/today", hidden)).toBe(false);
  });

  it("filters menu links only after role and job-role checks, never granting staff money access", () => {
    const allShown = new Set(FEATURE_KEYS);
    const noFeatures = new Set<never>();
    const owner = deskNavigation("OWNER", null, allShown).flatMap(g => g.links.map(l => l.href));
    expect(owner).toContain("/desk/dispatch");
    expect(deskNavigation("OWNER", null, noFeatures).flatMap(g => g.links.map(l => l.href))).not.toContain("/desk/dispatch");
    expect(deskNavigation("STAFF", ["customers"], allShown).flatMap(g => g.links.map(l => l.href))).not.toContain("/desk/billing");
    expect(deskNavigation("STAFF", ["customers"], allShown).flatMap(g => g.links.map(l => l.href))).not.toContain("/desk/dispatch");
    expect(deskMoreLinks("ADMIN", null, allShown).some(l => l.href === "/desk/settings/permissions")).toBe(false);
    expect(deskNavigation("ACCOUNTANT", null, noFeatures).flatMap(g => g.links.map(l => l.href))).not.toContain("/desk/settings");
  });

  it("only shows Practice with a safe configured HTTPS URL and never in testing", () => {
    expect(practiceAppUrl({})).toBeNull();
    expect(practiceAppUrl({ PRACTICE_APP_URL: "javascript:alert(1)" })).toBeNull();
    expect(practiceAppUrl({ PRACTICE_APP_URL: "https://owner:secret@example.com" })).toBeNull();
    expect(practiceAppUrl({ PRACTICE_APP_URL: "https://practice.example.test/app", APP_ENV: "testing" })).toBeNull();
    expect(practiceAppUrl({ PRACTICE_APP_URL: "https://practice.example.test/app" })).toBe("https://practice.example.test/app");
  });

  it("uses only an additive migration; no existing user data is updated", () => {
    const sql = readFileSync("prisma/migrations/20261026000000_shown_features/migration.sql", "utf8");
    expect(sql).toMatch(/ALTER TABLE "BusinessSettings" ADD COLUMN "shownFeatures" TEXT\[\] NOT NULL DEFAULT/);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b/i);
  });
});
