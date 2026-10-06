import fs from "node:fs";
import { test } from "@playwright/test";
import { automatedAccessibilityRoutes } from "./route-inventory";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

const OWNER_STATE = "e2e/.auth/owner.json";
const STAFF_STATE = "e2e/.auth/staff.json";
const ownerRoutes = automatedAccessibilityRoutes("OWNER").filter((_, index) => index % 2 === 1);

test.describe("generated accessibility routes — desk B", () => {
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

test.describe("generated accessibility routes — staff", () => {
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
