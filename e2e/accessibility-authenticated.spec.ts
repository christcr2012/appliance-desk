import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAs } from "./utils/auth";

// Same automated WCAG 2.1 AA checks as e2e/accessibility.spec.ts, but for
// the pages that require being logged in — the owner desk and the
// customer portal. These were previously untested by any automated
// accessibility check (only the public site, /login, /forgot-password,
// and /reset-password were covered), which meant every /desk/** and
// /account/** page — including the billing pages added in Phase 6B —
// had never actually been run through axe. See docs/DESIGN-SYSTEM.md.
//
// Requires OWNER_EMAIL/OWNER_PASSWORD and TEST_CUSTOMER_EMAIL/
// TEST_CUSTOMER_PASSWORD to be set (prisma/seed.ts creates the matching
// accounts when they are) — CI sets both against its own throwaway
// database. Skips itself entirely if they're not set, so a local
// `npm run test:e2e` without those env vars doesn't fail for an
// unrelated reason.

const OWNER_EMAIL = process.env.OWNER_EMAIL;
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const CUSTOMER_EMAIL = process.env.TEST_CUSTOMER_EMAIL;
const CUSTOMER_PASSWORD = process.env.TEST_CUSTOMER_PASSWORD;

const DESK_PAGES = [
  "/desk/dashboard",
  "/desk/leads",
  "/desk/customers",
  "/desk/agreements",
  "/desk/billing",
  "/desk/jobs",
  "/desk/maintenance",
  "/desk/inventory",
  "/desk/parts",
  "/desk/activity",
  "/desk/settings",
];

const ACCOUNT_PAGES = ["/account", "/account/rentals", "/account/maintenance", "/account/billing"];

test.describe("desk pages (logged in as OWNER)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !OWNER_EMAIL || !OWNER_PASSWORD,
      "OWNER_EMAIL/OWNER_PASSWORD not set — this suite only runs where prisma/seed.ts seeded a real test-only owner account (CI).",
    );
    await loginAs(page, OWNER_EMAIL!, OWNER_PASSWORD!);
  });

  for (const path of DESK_PAGES) {
    test(`${path} has no automatically detectable accessibility violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe("account pages (logged in as CUSTOMER)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !CUSTOMER_EMAIL || !CUSTOMER_PASSWORD,
      "TEST_CUSTOMER_EMAIL/TEST_CUSTOMER_PASSWORD not set — this suite only runs where prisma/seed.ts seeded a real test-only customer account (CI).",
    );
    await loginAs(page, CUSTOMER_EMAIL!, CUSTOMER_PASSWORD!);
  });

  for (const path of ACCOUNT_PAGES) {
    test(`${path} has no automatically detectable accessibility violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
