import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function accessible(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    `Horizontal overflow at ${page.url()}`,
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
for (const role of ["owner", "customer"] as const) {
  const state = `e2e/.auth/${role}.json`;
  test.describe(`${role} focused workspaces`, () => {
    test.use({ storageState: fs.existsSync(state) ? state : undefined });
    test.beforeEach(() => {
      if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
      test.skip(
        !process.env.CI || !fs.existsSync(state),
        "Disposable CI role fixtures only",
      );
    });
    for (const width of [360, 768, 1440])
      for (const theme of ["light", "dark"]) {
        test(`sections at ${width}px ${theme}`, async ({ page }, info) => {
          test.setTimeout(90_000);
          await page.setViewportSize({ width, height: 900 });
          await page.addInitScript(
            (mode) => localStorage.setItem("theme", mode),
            theme,
          );
          const routes =
            role === "owner"
              ? [
                  "profile",
                  "service-area",
                  "products",
                  "policies",
                  "website",
                  "notifications",
                  "staff",
                  "integrations",
                ]
                  .map((section) => `/desk/settings?section=${section}`)
                  .concat("/desk/billing?filter=delinquent")
              : [
                  "/account",
                  "/account/rentals",
                  "/account/billing",
                  "/account/maintenance?request=pickup",
                ];
          for (const route of routes) {
            await page.goto(route);
            await expect(page.locator("main h1")).toBeVisible();
            await accessible(page);
            if (route === routes[0]) {
              const image = info.outputPath(`${role}-${width}-${theme}.png`);
              await page.screenshot({ path: image, fullPage: true });
              await info.attach(`${role}-${width}-${theme}`, {
                path: image,
                contentType: "image/png",
              });
            }
          }
        });
      }
    if (role === "owner") {
      test("section save survives reload and browser Back restores its selected section", async ({
        page,
      }) => {
        await page.goto("/desk/settings?section=service-area");
        const cities = page.getByLabel("Cities (comma-separated)");
        const original = await cities.inputValue();
        try {
          await cities.fill(
            [original, "CI fixture city"].filter(Boolean).join(", "),
          );
          await page.getByRole("button", { name: "Save this section" }).click();
          await expect(page.getByRole("status")).toHaveText("Settings saved.");
          await page.reload();
          await expect(cities).toHaveValue(
            [original, "CI fixture city"].filter(Boolean).join(", "),
          );
          await page
            .getByRole("navigation", { name: "Settings sections" })
            .getByRole("link", { name: "Business profile", exact: true })
            .click();
          await expect(page).toHaveURL(/section=profile$/);
          await page.goBack();
          await expect(page).toHaveURL(/section=service-area$/);
          await expect(cities).toBeVisible();
        } finally {
          await page.goto("/desk/settings?section=service-area");
          await cities.fill(original);
          await page.getByRole("button", { name: "Save this section" }).click();
          await expect(page.getByRole("status")).toHaveText("Settings saved.");
        }
      });
      test("All invoices clears filter and invoice opens exact record", async ({
        page,
      }) => {
        await page.goto("/desk/billing?filter=delinquent");
        await page
          .getByRole("navigation", { name: "Filter invoices" })
          .getByRole("link", { name: "All invoices", exact: true })
          .click();
        await expect(page).toHaveURL(/\/desk\/billing$/);
        const invoice = page.locator('main a[href*="/invoice/"]').first();
        const href = await invoice.getAttribute("href");
        await invoice.click();
        await expect(page).toHaveURL(new RegExp(href! + "$"));
        await accessible(page);
        await page.goto(href!.split("/invoice/")[0]);
        await accessible(page);
      });
    } else {
      test("pickup is a confirmed review request and remains after reload", async ({
        page,
      }) => {
        await page.goto("/account");
        await page
          .getByRole("link", { name: "Request pickup", exact: true })
          .click();
        await expect(page).toHaveURL(/request=pickup$/);
        await expect(page.getByRole("status")).toContainText("does not cancel");
        const text = `Pickup request: CI fixture washer next week ${Date.now()}`;
        await page.getByLabel("What's going on?").fill(text);
        await page.getByRole("button", { name: "Submit request" }).click();
        await expect(page.getByText(text, { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByText(text, { exact: true })).toBeVisible();
      });
    }
  });
}
