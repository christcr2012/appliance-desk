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
    test(route.path, async ({ page }, info) => {
      await scanAccessibilityRoute(
        page,
        route,
        route.path === "/" ? [360, 390, 768, 1440] : undefined,
      );

      if (route.path === "/") {
        await page.goto("/?home=live");
        for (const theme of ["light", "dark"] as const) {
          await page.evaluate((mode) => {
            localStorage.setItem("theme", mode);
            document.documentElement.classList.toggle("dark", mode === "dark");
            document.documentElement.style.colorScheme = mode;
          }, theme);
          for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            const image = info.outputPath(`public-home-${width}-${theme}.png`);
            await page.screenshot({ path: image, fullPage: true });
            await info.attach(`public-home-${width}-${theme}`, {
              path: image,
              contentType: "image/png",
            });
          }
        }
      }
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
