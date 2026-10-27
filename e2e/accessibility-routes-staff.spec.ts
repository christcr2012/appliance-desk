import fs from "node:fs";
import { test } from "@playwright/test";
import { automatedAccessibilityRoutes } from "./route-inventory";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

const STAFF_STATE = "e2e/.auth/staff.json";

test.describe("generated accessibility routes — staff", () => {
  // Each test only loads one page and scans it (no data changes), so the tests in this
  // group can run on both Playwright workers at once (CI speed, 2026-10-06).
  test.describe.configure({ mode: "parallel" });
  test.use({
    storageState: fs.existsSync(STAFF_STATE) ? STAFF_STATE : undefined,
  });
  test.beforeEach(() => {
    test.skip(!fs.existsSync(STAFF_STATE), "Requires the isolated CI staff fixture.");
  });

  for (const route of automatedAccessibilityRoutes("STAFF")) {
    test(route.path, async ({ page }) => {
      await scanAccessibilityRoute(page, route);
    });
  }
});
