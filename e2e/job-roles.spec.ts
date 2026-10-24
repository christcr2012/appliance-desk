import fs from "node:fs";
import { expect, test } from "@playwright/test";

// ACC-5: the owner sees the four starting job roles under Settings -> Team, and staff can never be given money screens.
const state = "e2e/.auth/owner.json";

test.use({ storageState: fs.existsSync(state) ? state : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
  test.skip(!process.env.CI || !fs.existsSync(state), "Disposable CI role fixtures only");
});

test("the owner sees the four starting job roles", async ({ page }) => {
  await page.goto("/desk/settings?section=staff");
  await expect(page.getByRole("heading", { name: "Job roles" })).toBeVisible();
  for (const name of ["Driver / technician", "Office", "Bookkeeper", "Manager"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
});

test("a new staff job role cannot include money screens", async ({ page }) => {
  await page.goto("/desk/settings?section=staff");
  await page.getByRole("button", { name: "New job role" }).click();
  await expect(page.getByLabel("Money, revenue, reports and fleet")).toBeDisabled();
  await expect(page.getByLabel("Customers", { exact: true })).toBeEnabled();
  await page.getByLabel("Access level", { exact: true }).selectOption("ADMIN");
  await expect(page.getByLabel("Money, revenue, reports and fleet")).toBeEnabled();
});
