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
  // AR-8: the job-roles editor opens from its panel row on Team & access.
  await page.getByRole("button", { name: /Job roles/ }).click();
  await expect(page.getByRole("heading", { name: "Job roles" })).toBeVisible();
  for (const name of ["Driver / technician", "Office", "Bookkeeper", "Manager"]) {
    // Scoped to the Job roles section: the same names also appear as choices in the people's drop-downs.
    await expect(page.getByRole("region", { name: "Job roles" }).getByText(name, { exact: true }).first()).toBeVisible();
  }
});

test("a new staff job role cannot include money screens", async ({ page }) => {
  await page.goto("/desk/settings?section=staff");
  // AR-8: the job-roles editor opens from its panel row on Team & access.
  await page.getByRole("button", { name: /Job roles/ }).click();
  await page.getByRole("button", { name: "New job role" }).click();
  const screens = page.getByRole("group", { name: "Screens this job role can open" });
  await expect(screens.getByLabel("Money, revenue, reports and fleet")).toBeDisabled();
  await expect(screens.getByLabel("Customers", { exact: true })).toBeEnabled();
  await page.getByRole("region", { name: "Job roles" }).getByLabel("Access level", { exact: true }).selectOption("ADMIN");
  await expect(screens.getByLabel("Money, revenue, reports and fleet")).toBeEnabled();
});
