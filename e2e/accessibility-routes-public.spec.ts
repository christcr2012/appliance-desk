import fs from "node:fs";
import { test } from "@playwright/test";
import {
  automatedAccessibilityRoutes,
  type AccessibilityRouteRole,
} from "./route-inventory";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

const CUSTOMER_STATE = "e2e/.auth/customer.json";

function routesFor(...roles: AccessibilityRouteRole[]) {
  return roles.flatMap((role) => automatedAccessibilityRoutes(role));
}

test.describe("generated accessibility routes — public", () => {
  for (const route of routesFor("PUBLIC")) {
    test(route.path, async ({ page }) => {
      await scanAccessibilityRoute(page, route);
    });
  }
});

test.describe("generated accessibility routes — customer", () => {
  test.use({
    storageState: fs.existsSync(CUSTOMER_STATE) ? CUSTOMER_STATE : undefined,
  });
  test.beforeEach(() => {
    test.skip(!fs.existsSync(CUSTOMER_STATE), "Requires the isolated CI customer fixture.");
  });

  for (const route of routesFor("CUSTOMER")) {
    test(route.path, async ({ page }) => {
      await scanAccessibilityRoute(page, route);
    });
  }
});
