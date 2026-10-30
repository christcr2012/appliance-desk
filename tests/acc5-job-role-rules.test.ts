import { describe, expect, it } from "vitest";
import {
  JobRoleError, SCREENS, SCREEN_KEYS, STARTER_JOB_ROLES, jobRoleAllowsPath, screenForPath, validateJobRole,
} from "@/domains/team/job-role-rules";
import { visibleAreas, visibleProfileLinks } from "@/lib/desk-areas";
import { CAPABILITY_KEYS } from "@/domains/capabilities/labels";

// ACC-5 rules with no database: which address belongs to which screen, what a job role allows, what it can never be.
describe("job role screens", () => {
  it("groups the aliased addresses under one screen and always allows the personal ones", () => {
    expect(screenForPath("/desk/jobs/abc")).toBe("dispatch");
    expect(screenForPath("/desk/driver")).toBe("dispatch");
    expect(screenForPath("/desk/parts")).toBe("inventory");
    expect(screenForPath("/desk/reports?x=1")).toBe("billing");
    expect(screenForPath("/desk/settings/website")).toBe("management");
    for (const p of ["/desk", "/desk/today", "/desk/account/security", "/desk/security/setup", "/desk/notices", "/desk/search", "/desk/more", "/desk/help"]) {
      expect(screenForPath(p)).toBe("always");
    }
    expect(screenForPath("/account")).toBeNull();
    expect(screenForPath(null)).toBeNull();
  });

  it("no job role means no limit; a job role allows only what it lists; unknown addresses are refused", () => {
    expect(jobRoleAllowsPath(null, "/desk/billing")).toBe(true);
    expect(jobRoleAllowsPath(["customers"], "/desk/customers/123")).toBe(true);
    expect(jobRoleAllowsPath(["customers"], "/desk/billing")).toBe(false);
    expect(jobRoleAllowsPath([], "/desk/today")).toBe(true);
    expect(jobRoleAllowsPath(["customers"], "/desk/some-new-screen")).toBe(false);
    expect(jobRoleAllowsPath(["customers"], "/api/whatever")).toBe(false);
  });

  it("AR-3: the Money overview and Payments addresses belong to the billing screen", () => {
    // An admin whose job role includes Money keeps the new pages (and the billing view that redirects to one).
    for (const p of ["/desk/money", "/desk/payments", "/desk/payments?status=deposits", "/desk/billing?view=waiting"]) {
      expect(screenForPath(p)).toBe("billing");
      expect(jobRoleAllowsPath(["billing"], p)).toBe(true);
      expect(jobRoleAllowsPath(["customers"], p)).toBe(false);
    }
  });

  it("AR-9: the Insights addresses keep the screens their old pages had", () => {
    // Customers > Insights was Growth (management): Customers access alone must not open it.
    expect(screenForPath("/desk/customers/insights")).toBe("management");
    expect(jobRoleAllowsPath(["customers"], "/desk/customers/insights")).toBe(false);
    expect(jobRoleAllowsPath(["customers"], "/desk/customers")).toBe(true);
    expect(jobRoleAllowsPath(["customers", "management"], "/desk/customers/insights")).toBe(true);
    // Equipment > Insights was Fleet (billing): Equipment access alone must not open it.
    expect(screenForPath("/desk/inventory/insights")).toBe("billing");
    expect(jobRoleAllowsPath(["inventory"], "/desk/inventory/insights")).toBe(false);
    expect(jobRoleAllowsPath(["inventory"], "/desk/inventory")).toBe(true);
    expect(jobRoleAllowsPath(["inventory", "billing"], "/desk/inventory/insights")).toBe(true);
    // Money > Income was Revenue (billing); the rest of Money was already billing.
    expect(screenForPath("/desk/money/income")).toBe("billing");
    expect(screenForPath("/desk/money")).toBe("billing");
    // A customer record whose id happens to be "insights"-like still resolves by first segment.
    expect(screenForPath("/desk/customers/some-id")).toBe("customers");
  });

  it("every screen address in the menu belongs to a known screen", () => {
    const links = [...visibleAreas("OWNER", null).flatMap((a) => a.tabs), ...visibleProfileLinks("OWNER", null)];
    for (const link of links) expect(screenForPath(link.href), link.href).not.toBeNull();
  });

  it("the menu and More page only show what the job role includes", () => {
    const driver = STARTER_JOB_ROLES.find((r) => r.id === "jobrole-driver")!;
    const hrefs = visibleAreas("STAFF", driver.screens).flatMap((a) => a.tabs.map((t) => t.href));
    expect(hrefs).toContain("/desk/today");
    expect(hrefs).toContain("/desk/dispatch");
    expect(hrefs).not.toContain("/desk/customers");
    expect(hrefs).not.toContain("/desk/more");
    expect(visibleProfileLinks("STAFF", driver.screens).map((l) => l.href)).toEqual(["/desk/account", "/desk/activity", "/desk/help", "/desk/feedback/new"]);
  });
});

describe("job role validation", () => {
  const base = { label: "  Front   desk ", accessLevel: "STAFF", screens: ["customers", "customers", "tasks"], capabilityLimits: [] };
  it("cleans the name and drops repeated screens", () => {
    expect(validateJobRole(base, CAPABILITY_KEYS)).toEqual({ label: "Front desk", accessLevel: "STAFF", screens: ["customers", "tasks"], capabilityLimits: [] });
  });
  it("refuses empty or long names, owners, and unknown screens or permissions", () => {
    expect(() => validateJobRole({ ...base, label: " " }, CAPABILITY_KEYS)).toThrow(JobRoleError);
    expect(() => validateJobRole({ ...base, label: "x".repeat(41) }, CAPABILITY_KEYS)).toThrow(JobRoleError);
    expect(() => validateJobRole({ ...base, accessLevel: "OWNER" }, CAPABILITY_KEYS)).toThrow(JobRoleError);
    expect(() => validateJobRole({ ...base, screens: ["nope"] }, CAPABILITY_KEYS)).toThrow(JobRoleError);
    expect(() => validateJobRole({ ...base, accessLevel: "ADMIN", capabilityLimits: ["nope"] }, CAPABILITY_KEYS)).toThrow(JobRoleError);
  });
  it("staff can never get a money or settings screen, or admin permission limits", () => {
    for (const key of SCREEN_KEYS.filter((k) => SCREENS[k].money)) {
      expect(() => validateJobRole({ ...base, screens: [key] }, CAPABILITY_KEYS), key).toThrow(/Staff cannot/);
      expect(() => validateJobRole({ ...base, accessLevel: "ADMIN", screens: [key] }, CAPABILITY_KEYS)).not.toThrow();
    }
    expect(() => validateJobRole({ ...base, capabilityLimits: ["EDIT_SETTINGS"] }, CAPABILITY_KEYS)).toThrow(JobRoleError);
  });
  it("the four starting job roles pass their own rules", () => {
    expect(STARTER_JOB_ROLES.map((r) => r.label)).toEqual(["Driver / technician", "Office", "Bookkeeper", "Manager"]);
    for (const r of STARTER_JOB_ROLES) expect(() => validateJobRole(r, CAPABILITY_KEYS), r.label).not.toThrow();
    expect(STARTER_JOB_ROLES.find((r) => r.id === "jobrole-manager")!.screens).toEqual(SCREEN_KEYS);
    expect(STARTER_JOB_ROLES.find((r) => r.id === "jobrole-bookkeeper")!.capabilityLimits).toEqual(["EDIT_SETTINGS"]);
  });
});
