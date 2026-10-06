import fs from "node:fs";
import { test } from "@playwright/test";
import { automatedAccessibilityRoutes } from "./route-inventory";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

const OWNER_STATE = "e2e/.auth/owner.json";
const ownerRoutes = automatedAccessibilityRoutes("OWNER").filter((_, index) => index % 2 === 0);

test.describe("generated accessibility routes — desk A", () => {
  // Each test only loads one page and scans it (no data changes), so the tests in this
  // group can run on both Playwright workers at once (CI speed, 2026-10-06).
  test.describe.configure({ mode: "parallel" });
  test.use({
    storageState: fs.existsSync(OWNER_STATE) ? OWNER_STATE : undefined,
  });
  test.beforeEach(() => {
    test.skip(!fs.existsSync(OWNER_STATE), "Requires the isolated CI owner fixture.");
  });

  for (const route of ownerRoutes) {
    test(route.path, async ({ page }) => {
      await scanAccessibilityRoute(page, route);
    });
  }
});
