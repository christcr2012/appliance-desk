import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HELP_GUIDES, searchHelpGuides, visibleHelpGuides } from "@/lib/help-guides";
import { jobRoleAllowsPath, screenForPath } from "@/domains/team/job-role-rules";

describe("AR-12 How do I guides", () => {
  it("has all 15 distinct, three-step answers with a real desk destination", () => {
    expect(HELP_GUIDES).toHaveLength(15);
    expect(new Set(HELP_GUIDES.map(guide => guide.id)).size).toBe(15);
    for (const guide of HELP_GUIDES) {
      expect(guide.question).toMatch(/^How do I /);
      expect(guide.steps).toHaveLength(3);
      expect(guide.steps.every(step => step.trim().length > 25)).toBe(true);
      expect(guide.keywords.length).toBeGreaterThan(0);
      const path = new URL(guide.href, "https://example.invalid").pathname;
      expect(path).toMatch(/^\/desk\//);
      expect(existsSync(join("src/app", path, "page.tsx")), guide.href).toBe(true);
    }
  });

  it("matches questions and keywords case-insensitively without changing order", () => {
    expect(searchHelpGuides(HELP_GUIDES, " ReFuNd ").map(guide => guide.id)).toEqual(["refund-payment"]);
    expect(searchHelpGuides(HELP_GUIDES, "driver").map(guide => guide.id)).toEqual(["schedule-delivery", "schedule-pickup"]);
    expect(searchHelpGuides(HELP_GUIDES, "??")).toHaveLength(0);
    expect(searchHelpGuides(HELP_GUIDES, "")).toHaveLength(15);
  });

  it("makes Help always available while keeping staff away from finance and owner-only guides", () => {
    expect(screenForPath("/desk/help")).toBe("always");
    expect(jobRoleAllowsPath([], "/desk/help")).toBe(true);
    expect(visibleHelpGuides("CUSTOMER", null)).toEqual([]);
    expect(visibleHelpGuides("STAFF", null).every(guide => !["card-payment", "refund-payment", "add-team", "retire-appliance", "practice-safely"].includes(guide.id))).toBe(true);
    expect(visibleHelpGuides("STAFF", []).map(guide => guide.id)).toEqual(["snooze-task", "install-desk"]);
    expect(visibleHelpGuides("OWNER", null)).toHaveLength(15);
    expect(visibleHelpGuides("ADMIN", ["tasks"]).map(guide => guide.id)).toEqual(["snooze-task", "install-desk"]);
  });
});
