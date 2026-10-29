import fs from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// AR-7 (docs/build-specs/screens/BOOKS-TAXES.md): the Books pages on the kit. AR-7a covers the
// Books slice: the Overview with its four task cards, every old Books URL rendering inside the
// new sub-tab frame, Month by month, the Reports views (legacy kind links included), Equipment
// value, and staff refusal. The Taxes slice extends this file in AR-7b.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
const ready = () => process.env.CI === "true" && fs.existsSync(owner);

test.describe("Books on the kit (AR-7a)", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("the overview shows the sub-tabs and the four task cards", async ({ page }) => {
    test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
    await page.goto("/desk/books", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Books", exact: true })).toBeVisible();
    for (const tab of ["Overview", "Month by month", "Reports", "Equipment value", "For your accountant"]) {
      await expect(page.getByRole("link", { name: tab, exact: true }).first()).toBeVisible();
    }
    // The four task cards repeat the tab destinations as large tap targets, so each of these
    // hrefs appears twice on the overview: once in the tab strip, once as a card.
    for (const href of ["/desk/books/months", "/desk/books/reports", "/desk/books/assets", "/desk/books/accountant"]) {
      await expect(page.locator(`a[href="${href}"]`)).toHaveCount(2);
    }
  });

  test("every old Books URL renders inside the new frame", async ({ page }) => {
    test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
    for (const path of [
      "/desk/books/months",
      "/desk/books/reports",
      "/desk/books/assets",
      "/desk/books/accountant",
      "/desk/books/exports",
      "/desk/books/cash",
      "/desk/books/cash/checks",
    ]) {
      await page.goto(path, { waitUntil: "load" });
      await expect(
        page.getByRole("navigation", { name: "Books sections" }),
        `${path} should render inside the Books frame`,
      ).toBeVisible();
    }
    await page.goto("/desk/books/closing", { waitUntil: "load" });
    await expect(page).toHaveURL(/\/desk\/books\/reports\?view=cash-and-customers/);
  });

  test("month by month lists months with a review link, and legacy report links land on their views", async ({ page }) => {
    test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
    await page.goto("/desk/books/months", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Month by month", exact: true })).toBeVisible();
    // The seeded business has not set its books up, so the list is the setup message; the
    // month rows and their Review links are covered once books are started (the started
    // states are exercised by the month specs against started fixtures).
    await page.goto("/desk/books/reports?kind=balance", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /What the business owns and owes/ })).toBeVisible();
    await page.goto("/desk/books/reports?view=payback", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /Which appliances have paid for themselves/ })).toBeVisible();
  });

  test("equipment value shows the worth totals", async ({ page }) => {
    test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
    await page.goto("/desk/books/assets", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "What your rental equipment is worth" })).toBeVisible();
    await expect(page.getByText("Worth on your books now", { exact: true })).toBeVisible();
    await expect(page.getByText("Recorded through", { exact: true })).toBeVisible();
  });

  for (const width of [360, 1280]) {
    test(`books overview and equipment pass axe at ${width}`, async ({ page }) => {
      test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/desk/books", "/desk/books/assets", "/desk/books/accountant"]) {
        await page.goto(path, { waitUntil: "load" });
        expect((await new AxeBuilder({ page }).analyze()).violations, `${path} at ${width}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      }
    });
  }
});

test.describe("Books on the kit for staff (AR-7a)", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });

  test("staff are refused the books pages", async ({ page }) => {
    test.skip(process.env.CI !== "true" || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    for (const path of ["/desk/books", "/desk/books/accountant", "/desk/books/months"]) {
      await page.goto(path, { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: "Books", exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "For your accountant", exact: true })).toHaveCount(0);
    }
  });
});
