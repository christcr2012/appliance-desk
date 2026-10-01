import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { businessDateKey } from "../src/lib/business-date";
const owner = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(
    !process.env.CI || !fs.existsSync(owner),
    "Uses only disposable CI owner fixtures",
  );
});
test("assign, preserve competing text, complete and reopen the same linked follow-up", async ({
  page,
  context,
}) => {
  const note = `CI assigned follow-up ${Date.now()}`;
  await page.goto("/desk/customers");
  const customerLink = page
    .locator("main")
    .getByRole("link")
    .filter({
      hasText: process.env.TEST_CUSTOMER_EMAIL ?? "ci-customer@example.test",
    });
  const customerUrl = (await customerLink.getAttribute("href"))!;
  await page.goto(customerUrl);
  await page.getByLabel("New task", { exact: true }).fill(note);
  await page
    .getByLabel("Due date (optional)")
    .fill(businessDateKey(new Date()));
  await page.getByLabel("Priority", { exact: true }).selectOption("HIGH");
  await page
    .getByLabel("Assigned to", { exact: true })
    .selectOption({ label: "Chris Robinson" });
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Task added.");
  await page.goto("/desk/tasks?view=mine&due=today");
  const row = page.getByRole("listitem").filter({ hasText: note });
  await expect(row).toBeVisible();
  await expect(row.getByRole("link")).toHaveAttribute("href", customerUrl);
  const second = await context.newPage();
  await second.goto("/desk/tasks?view=mine&due=today");
  const competingRow = second.getByRole("listitem").filter({ hasText: note });
  await row.getByRole("button", { name: "Edit task", exact: true }).click();
  await competingRow
    .getByRole("button", { name: "Edit task", exact: true })
    .click();
  await row.getByLabel("Task note").fill(`${note} updated`);
  await row.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("Task updated.");
  await competingRow.getByLabel("Task note").fill(`${note} preserved draft`);
  await competingRow
    .getByRole("button", { name: "Save task", exact: true })
    .click();
  await expect(competingRow.getByRole("alert")).toContainText(
    "Someone changed",
  );
  await expect(competingRow.getByLabel("Task note")).toHaveValue(
    `${note} preserved draft`,
  );
  await second.close();
  await row.getByRole("button", { name: "Done", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/desk/tasks?view=completed&due=today");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/desk/tasks?view=mine&due=today");
  await row.getByRole("button", { name: "Edit task", exact: true }).click();
  await row.getByLabel("Assigned to").selectOption("");
  await row.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/desk/tasks?view=unassigned&due=today");
  await expect(row).toContainText("Unassigned");
  await expect(row.getByRole("link")).toHaveAttribute("href", customerUrl);
  await row.getByRole("button", { name: "Edit task", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await row.getByRole("button", { name: "Cancel edit", exact: true }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await row
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(row).toHaveCount(0);
});
