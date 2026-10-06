import { test, expect } from "@playwright/test";

// Generated route coverage now checks every deterministic route in both light
// and dark mode. Keep this focused regression for the user-facing theme switch.

test("the theme toggle switches to dark and back, and the choice survives a reload", async ({
  page,
}) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Switch to dark mode" });
  await expect(toggle).toBeVisible();

  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
