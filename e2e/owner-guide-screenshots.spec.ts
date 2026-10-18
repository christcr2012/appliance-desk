import fs from "node:fs";
import { test, expect } from "@playwright/test";

// F2-C (WU-F6): retakes the owner guide's pictures from the practice (throwaway) database with its made-up data.
// Skipped unless OWNER_GUIDE_SHOTS=1, so normal CI runs never write files.
//   OWNER_GUIDE_SHOTS=1 npm run test:browser -- e2e/owner-guide-screenshots.spec.ts
// The pictures land in docs/owner-guide/screenshots/ and are embedded by docs/OWNER-GUIDE.md.
const OUT = "docs/owner-guide/screenshots";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.OWNER_GUIDE_SHOTS === "1" && process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";

const GUIDE_SHOTS: Array<{ file: string; path: string; as: "owner" | "customer" | "visitor"; mustSee: RegExp }> = [
  { file: "today.png", path: "/desk/today", as: "owner", mustSee: /Today/i },
  { file: "leads.png", path: "/desk/leads", as: "owner", mustSee: /Leads/i },
  { file: "customers.png", path: "/desk/customers", as: "owner", mustSee: /Customers/i },
  { file: "agreements.png", path: "/desk/agreements", as: "owner", mustSee: /agreement|rental/i },
  { file: "dispatch.png", path: "/desk/dispatch", as: "owner", mustSee: /Dispatch|Schedule/i },
  { file: "inventory.png", path: "/desk/inventory", as: "owner", mustSee: /Inventory/i },
  { file: "billing.png", path: "/desk/billing", as: "owner", mustSee: /Billing/i },
  { file: "settings.png", path: "/desk/settings", as: "owner", mustSee: /Settings/i },
  { file: "website.png", path: "/desk/settings/website", as: "owner", mustSee: /Website/i },
  { file: "portal.png", path: "/account", as: "customer", mustSee: /rent|account|home/i },
  { file: "home.png", path: "/", as: "visitor", mustSee: /./ },
];

test.describe("owner guide screenshots", () => {
  test.skip(!enabled, "Set OWNER_GUIDE_SHOTS=1 on the disposable CI database to retake the guide pictures");
  test.setTimeout(240_000);
  for (const shot of GUIDE_SHOTS) {
    test(shot.file, async ({ browser }) => {
      const state = shot.as === "visitor" ? undefined : `e2e/.auth/${shot.as}.json`;
      test.skip(state !== undefined && !fs.existsSync(state), `${shot.as} session is missing`);
      const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(shot.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).toContainText(shot.mustSee);
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/${shot.file}`, animations: "disabled" });
      await context.close();
    });
  }
});
