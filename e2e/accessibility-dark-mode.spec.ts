import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Dark mode (Chris asked for this, 2026-09-27) is implemented as a
// centralized set of CSS overrides for the owner desk/customer portal's
// hard-coded colors (see globals.css's big comment for why), rather than
// touching every one of those ~55 files individually — which means it's
// easy to get a color pairing wrong somewhere without ever noticing
// visually. This is the real check that it didn't: the exact same pages
// and axe rules as e2e/accessibility.spec.ts and
// accessibility-authenticated.spec.ts, just with the browser's
// prefers-color-scheme set to dark before each page loads (our
// anti-flash script in the root layout follows that automatically when
// no explicit choice has been saved yet — see src/lib/theme.ts).

const OWNER_STATE_PATH = "e2e/.auth/owner.json";
const CUSTOMER_STATE_PATH = "e2e/.auth/customer.json";

const PUBLIC_PAGES = ["/", "/login", "/pricing", "/how-it-works", "/contact"];
const DESK_PAGES = ["/desk/today", "/desk/dashboard", "/desk/agreements", "/desk/billing", "/desk/inventory"];
const ACCOUNT_PAGES = ["/account", "/account/billing"];

/**
 * The public marketing header intentionally uses `transition-colors`.
 * Adding `.dark` switches its token immediately, but a rendered nav link can
 * spend ~150ms interpolating from the old light color to the final dark color.
 * Axe must inspect the settled theme, not a transient animation frame.
 *
 * Pages such as /login do not render that marketing nav at all. In that case
 * there is no public-header transition to wait for; `.dark` plus the normal Axe
 * scan remains the correct readiness/quality check.
 */
async function expectPublicDarkThemeSettled(page: Page) {
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const transitioning = document.querySelector<HTMLAnchorElement>(
            'header a[href="/pricing"]',
          );
          if (!transitioning) return true;

          const probe = document.createElement("span");
          probe.className = "text-ink-soft";
          probe.setAttribute("aria-hidden", "true");
          probe.style.position = "absolute";
          probe.style.visibility = "hidden";
          document.body.appendChild(probe);
          const settled =
            getComputedStyle(transitioning).color === getComputedStyle(probe).color;
          probe.remove();
          return settled;
        }),
      {
        message:
          "public dark-mode color transition should settle before accessibility analysis",
      },
    )
    .toBe(true);
}

test.describe("public pages in dark mode", () => {
  test.use({ colorScheme: "dark" });

  for (const path of PUBLIC_PAGES) {
    test(`${path} has no automatically detectable accessibility violations in dark mode`, async ({
      page,
    }) => {
      await page.goto(path);
      await expectPublicDarkThemeSettled(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe("desk pages in dark mode (logged in as OWNER)", () => {
  test.use({
    colorScheme: "dark",
    storageState: fs.existsSync(OWNER_STATE_PATH) ? OWNER_STATE_PATH : undefined,
  });

  test.beforeEach(async () => {
    test.skip(
      !fs.existsSync(OWNER_STATE_PATH),
      "No saved OWNER session — see accessibility-authenticated.spec.ts's comment.",
    );
  });

  for (const path of DESK_PAGES) {
    test(`${path} has no automatically detectable accessibility violations in dark mode`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveClass(/dark/);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe("account pages in dark mode (logged in as CUSTOMER)", () => {
  test.use({
    colorScheme: "dark",
    storageState: fs.existsSync(CUSTOMER_STATE_PATH) ? CUSTOMER_STATE_PATH : undefined,
  });

  test.beforeEach(async () => {
    test.skip(
      !fs.existsSync(CUSTOMER_STATE_PATH),
      "No saved CUSTOMER session — see accessibility-authenticated.spec.ts's comment.",
    );
  });

  for (const path of ACCOUNT_PAGES) {
    test(`${path} has no automatically detectable accessibility violations in dark mode`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveClass(/dark/);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test("the theme toggle switches to dark and back, and the choice survives a reload", async ({
  page,
}) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Switch to dark mode" });
  await expect(toggle).toBeVisible();

  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
