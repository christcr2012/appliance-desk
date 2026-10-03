import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Same automated WCAG 2.1 AA checks as e2e/accessibility.spec.ts, but for
// the pages that require being logged in — the owner desk and the
// customer portal. These were previously untested by any automated
// accessibility check (only the public site, /login, /forgot-password,
// and /reset-password were covered), which meant every /desk/** and
// /account/** page — including the billing pages added in Phase 6B —
// had never actually been run through axe. See docs/DESIGN-SYSTEM.md.
//
// Each describe block reuses a session saved once by e2e/global-setup.ts
// (via test.use({ storageState })), rather than every test logging in
// for real — see that file's comment for why (an earlier per-test-login
// version of this suite was flaky under Playwright's default
// parallelism).
//
// Requires OWNER_EMAIL/OWNER_PASSWORD and TEST_CUSTOMER_EMAIL/
// TEST_CUSTOMER_PASSWORD to be set (prisma/seed.ts creates the matching
// accounts, and global-setup logs in and saves their sessions, only when
// they are) — CI sets both against its own throwaway database. Skips
// itself entirely if the saved session file doesn't exist, so a local
// `npm run test:e2e` without those env vars doesn't fail for an
// unrelated reason.

const OWNER_STATE_PATH = "e2e/.auth/owner.json";
const CUSTOMER_STATE_PATH = "e2e/.auth/customer.json";

const DESK_PAGES = [
  "/desk/launch",
  "/desk/today",
  "/desk/dashboard",
  "/desk/leads",
  "/desk/customers",
  "/desk/customers/new",
  "/desk/agreements",
  "/desk/billing",
  "/desk/billing/held-payments",
  "/desk/jobs",
  "/desk/dispatch",
  "/desk/maintenance",
  "/desk/inventory",
  "/desk/parts",
  "/desk/activity",
  "/desk/search",
  "/desk/reports",
  "/desk/growth",
  "/desk/settings",
];

const ACCOUNT_PAGES = [
  "/account",
  "/account/rentals",
  "/account/maintenance",
  "/account/billing",
];

test.describe("desk pages (logged in as OWNER)", () => {
  test.use({
    storageState: fs.existsSync(OWNER_STATE_PATH)
      ? OWNER_STATE_PATH
      : undefined,
  });

  test.beforeEach(async () => {
    test.skip(
      !fs.existsSync(OWNER_STATE_PATH),
      "No saved OWNER session — set OWNER_EMAIL/OWNER_PASSWORD so prisma/seed.ts and e2e/global-setup.ts can create one (CI does).",
    );
  });

  for (const path of DESK_PAGES) {
    test(`${path} has no automatically detectable accessibility violations`, async ({
      page,
    }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe("account pages (logged in as CUSTOMER)", () => {
  test.use({
    storageState: fs.existsSync(CUSTOMER_STATE_PATH)
      ? CUSTOMER_STATE_PATH
      : undefined,
  });

  test.beforeEach(async () => {
    test.skip(
      !fs.existsSync(CUSTOMER_STATE_PATH),
      "No saved CUSTOMER session — set TEST_CUSTOMER_EMAIL/TEST_CUSTOMER_PASSWORD so prisma/seed.ts and e2e/global-setup.ts can create one (CI does).",
    );
  });

  for (const path of ACCOUNT_PAGES) {
    test(`${path} has no automatically detectable accessibility violations`, async ({
      page,
    }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
