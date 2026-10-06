import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = path.resolve("e2e/.auth/owner.json");
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(
    !process.env.CI || !fs.existsSync(owner),
    "Uses only CI's disposable customer fixture",
  );
});
async function customerUrl(page: Page) {
  await page.goto("/desk/customers");
  const email =
    process.env.TEST_CUSTOMER_EMAIL ?? "ci-customer@example.test";
  const row = page
    .locator("main tr:visible, main li:visible")
    .filter({ hasText: email })
    .first();
  await expect(row).toBeVisible();
  const link = row.getByRole("link").first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href"))!;
}
for (const width of [360, 768, 1440])
  for (const theme of ["light", "dark"]) {
    test(`customer sections and leads at ${width}px in ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (mode) => localStorage.setItem("theme", mode),
        theme,
      );
      const url = await customerUrl(page);
      for (const tab of [
        "overview",
        "properties",
        "rentals",
        "service",
        "billing",
        "activity",
      ]) {
        await page.goto(`${url}?tab=${tab}`);
        await expect(
          page
            .getByRole("navigation", { name: "Customer record sections" })
            .getByRole("link", {
              name: tab[0].toUpperCase() + tab.slice(1),
              exact: true,
            }),
        ).toHaveAttribute("aria-current", "page");
        await expect(page.locator("main h1")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        if (tab === "overview" || tab === "properties") {
          const image = info.outputPath(`${tab}-${width}-${theme}.png`);
          await page.screenshot({ path: image, fullPage: true });
          await info.attach(`${tab}-${width}-${theme}`, {
            path: image,
            contentType: "image/png",
          });
        }
      }
      await page.goto("/desk/leads?view=no-next-task");
      await expect(
        page.getByRole("heading", { name: "Leads", exact: true }),
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
test("property action preselects its own address and history note survives navigation", async ({
  page,
}) => {
  const url = await customerUrl(page);
  await page.goto(`${url}?tab=properties`);
  const action = page
    .getByRole("link", { name: "Schedule visit here" })
    .first();
  const target = new URL(
    (await action.getAttribute("href"))!,
    "http://localhost:3000",
  );
  await action.click();
  await expect(page.getByLabel("Service address")).toHaveValue(
    target.searchParams.get("serviceAddressId")!,
  );
  await page.goto(`${url}?tab=properties`);
  const rental = page.getByRole("link", { name: "New rental here" }).first();
  const rentalTarget = new URL(
    (await rental.getAttribute("href"))!,
    "http://localhost:3000",
  );
  await rental.click();
  await expect(page.getByLabel("Service address")).toHaveValue(
    rentalTarget.searchParams.get("serviceAddressId")!,
  );
  await page.goto(`${url}?tab=activity&filter=activity`);
  const note = `CI customer history ${Date.now()}`;
  await page.getByLabel("Add a note").fill(note);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page).toHaveURL(/\?tab=activity$/);
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Customer record sections" })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(page).toHaveURL(/\?tab=overview$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?tab=activity$/);
  await expect(page.getByText(note, { exact: true })).toBeVisible();
});
test("lead search/filter URL survives browser back and links its follow-up", async ({
  page,
}) => {
  const name = `CI inquiry ${Date.now()}`;
  await page.goto("/desk/leads/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Phone", { exact: true }).fill("9705550100");
  await page.getByRole("button", { name: "Add lead", exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/leads\/[^/]+$/);
  await expect(page.getByRole("button", { name: "Convert to customer" })).toBeDisabled();
  await page.getByLabel("Email for customer account").fill(`ci-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Save email", exact: true }).click();
  await expect(page.getByRole("button", { name: "Convert to customer" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Convert to customer" })).toBeEnabled();
  await page.goto(
    `/desk/leads?view=no-next-task&q=${encodeURIComponent(name)}`,
  );
  const row = page
    .locator("main tr:visible, main li:visible")
    .filter({ hasText: name })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Add next task" }).click();
  await expect(page).toHaveURL(/#follow-up$/);
  await page.goBack();
  await expect(page).toHaveURL(/view=no-next-task.*q=/);
  await expect(row).toBeVisible();
  await page
    .getByRole("navigation", { name: "Lead status" })
    .getByRole("link", { name: "Contacted", exact: true })
    .click();
  await expect(page).toHaveURL(/status=CONTACTED/);
  await page.goBack();
  await expect(row).toBeVisible();
});
