import { test, expect } from "@playwright/test";

// Focused interaction regressions that axe route inventory does not replace.
// Automated route-wide WCAG checks live in accessibility-routes-*.spec.ts.

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

test("mobile hamburger menu opens and closes with keyboard and mouse", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const openToggle = page.getByRole("button", { name: "Open menu" });
  await expect(openToggle).toBeVisible();
  await expect(openToggle).toHaveAttribute("aria-expanded", "false");

  await openToggle.click();
  const closeToggle = page.getByRole("button", { name: "Close menu" });
  await expect(closeToggle).toHaveAttribute("aria-expanded", "true");
  const mobileNav = page.locator("#mobile-menu");
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByRole("link", { name: "Pricing" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await expect(mobileNav).toBeHidden();
});

test("mobile menu reopens normally after being scrolled past while closed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const openToggle = page.getByRole("button", { name: "Open menu" });
  const mobileNav = page.locator("#mobile-menu");

  await openToggle.click();
  await expect(mobileNav).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(mobileNav).toBeHidden();

  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await openToggle.click();

  await expect(mobileNav).toBeVisible();
  await page.waitForTimeout(300);
  await expect(mobileNav).toBeVisible();
});
