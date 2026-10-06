import { test } from "@playwright/test";
import { AUTOMATED_ACCESSIBILITY_ROUTES } from "./route-inventory";
import { scanAccessibilityRoute } from "./accessibility-route-utils";

const ROUTES = AUTOMATED_ACCESSIBILITY_ROUTES.filter((route) => route.role === "OWNER");

test.describe("generated owner-desk WCAG 2.2 AA engineering checks", () => {
  for (const route of ROUTES) {
    test(route.path, async ({ browser }) => {
      await scanAccessibilityRoute(browser, route);
    });
  }
});
