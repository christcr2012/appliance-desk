import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated accessibility checks (WCAG 2.1 AA), per docs/DESIGN-SYSTEM.md.
// These catch missing labels, bad contrast, etc. automatically — they do
// NOT replace a manual screen-reader/keyboard pass before launch.

test("home page has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("login page has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("login form fields have accessible labels and keyboard focus works", async ({
  page,
}) => {
  await page.goto("/login");

  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  await page.getByLabel("Email").focus();
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
});

test("forgot-password page has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("reset-password page (no token) has no automatically detectable accessibility violations", async ({
  page,
}) => {
  // Without a real emailed link, Better Auth's own token/error handling
  // never runs — this exercises the "missing/expired link" state, which
  // is exactly what a customer clicking a stale link would see.
  await page.goto("/reset-password");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

const PUBLIC_PAGES = [
  "/pricing",
  "/how-it-works",
  "/service-area",
  "/contact",
  "/privacy",
  "/terms",
  "/accessibility",
];

for (const path of PUBLIC_PAGES) {
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

test("mobile hamburger menu opens and closes with keyboard and mouse", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const openToggle = page.getByRole("button", { name: "Open menu" });
  await expect(openToggle).toBeVisible();
  await expect(openToggle).toHaveAttribute("aria-expanded", "false");

  await openToggle.click();
  // The button's accessible name changes with state (see
  // src/components/site/header.tsx), so it's now found by its new name.
  const closeToggle = page.getByRole("button", { name: "Close menu" });
  await expect(closeToggle).toHaveAttribute("aria-expanded", "true");
  const mobileNav = page.locator("#mobile-menu");
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Pricing" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await expect(mobileNav).toBeHidden();
});
