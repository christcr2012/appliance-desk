import fs from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// AR-7 (docs/build-specs/screens/BOOKS-TAXES.md): the Books and Taxes pages on the kit. AR-7a
// covers the Books slice: the Overview with its four task cards, every old Books URL rendering
// inside the new sub-tab frame, Month by month, the Reports views (legacy kind links included),
// Equipment value, and staff refusal. AR-7b adds the Taxes slice below: the six sub-tabs, the
// Overview stat strip with the DEC-1 decisions count, and every Taxes URL inside the frame.
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
        // The pages stream: "load" can fire while the shell is in and the page's own
        // heading has not swapped in yet, and axe then reports page-has-heading-one on a
        // half-rendered document (CI runs 40812280709 / 40826019685: the first failing
        // page varied between runs, while books-workspace.spec.ts, which waits for the
        // "For your accountant" heading, passes on the same page). Wait for the real
        // heading before analyzing; the axe assertion itself is unchanged.
        await expect(page.locator("h1").first()).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations, `${path} at ${width}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      }
    });
  }
});

test.describe("Taxes on the kit (AR-7b)", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("the overview shows the six sub-tabs and the stat strip", async ({ page }) => {
    test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
    await page.goto("/desk/sales-tax", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Taxes", exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Taxes sections" });
    for (const tab of ["Overview", "Returns", "Areas & rates", "Exemptions", "Use tax", "Setup"]) {
      await expect(nav.getByRole("link", { name: tab, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Next return due", { exact: true })).toBeVisible();
    await expect(page.getByText("Decisions open", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
  });

  test("a desktop row click on Returns opens the guided return", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk/sales-tax/returns");
    await expect(page.locator("h1").first()).toBeVisible();
    const firstRow = page.locator("tbody tr").first();
    test.skip((await firstRow.count()) === 0, "No seeded returns to click.");
    await firstRow.locator("a").first().click();
    await expect(page).toHaveURL(/\/desk\/sales-tax\/returns\/[^/?]+$/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("every Taxes tab page renders inside the frame with its tab current", async ({ page }) => {
    test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
    for (const [path, tab] of [
      ["/desk/sales-tax/returns", "Returns"],
      ["/desk/sales-tax/areas", "Areas & rates"],
      ["/desk/sales-tax/exemptions", "Exemptions"],
      ["/desk/sales-tax/use-tax", "Use tax"],
      ["/desk/sales-tax/setup", "Setup"],
    ] as const) {
      await page.goto(path, { waitUntil: "load" });
      const nav = page.getByRole("navigation", { name: "Taxes sections" });
      await expect(nav, `${path} should render inside the Taxes frame`).toBeVisible();
      await expect(nav.getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
    }
  });

  for (const width of [360, 1280]) {
    test(`taxes overview and returns pass axe at ${width}`, async ({ page }) => {
      test.skip(!ready(), "Disposable Postgres and a saved owner session required.");
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/desk/sales-tax", "/desk/sales-tax/returns", "/desk/sales-tax/exemptions"]) {
        await page.goto(path, { waitUntil: "load" });
        // Same streaming race as the Books axe tests above: wait for the real
        // heading before analyzing; the axe assertion itself is unchanged.
        await expect(page.locator("h1").first()).toBeVisible();
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
      await page.goto(path, { waitUntil: "load" }).catch((error) => {
        // A refused page redirects to "/" from its server component; in a streamed
        // response that redirect can replace this navigation mid-load, and Playwright
        // then reports ERR_ABORTED (CI runs 40829366514 and 40835559457, both times on
        // the heaviest page, /desk/books/accountant). The bounce is the refusal — the
        // assertions below still prove staff never see the pages: the settled URL is
        // no longer the Books path and neither heading is present.
        if (!String(error).includes("ERR_ABORTED")) throw error;
      });
      await page.waitForLoadState("load");
      // Retrying assertion on purpose: the streamed redirect can land just after
      // the load event, so a one-shot page.url() read still shows the Books path.
      await expect(page).not.toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}($|[?#])`));
      await expect(page.getByRole("heading", { name: "Books", exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "For your accountant", exact: true })).toHaveCount(0);
    }
  });
});

test.describe("Taxes on the kit for staff (AR-7b)", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });

  test("staff are refused the taxes pages", async ({ page }) => {
    test.skip(process.env.CI !== "true" || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    for (const path of ["/desk/sales-tax", "/desk/sales-tax/returns", "/desk/sales-tax/setup"]) {
      await page.goto(path, { waitUntil: "load" }).catch((error) => {
        // Same streamed-redirect race as the Books staff test above: swallow only
        // ERR_ABORTED; the assertions below still prove the refusal.
        if (!String(error).includes("ERR_ABORTED")) throw error;
      });
      await page.waitForLoadState("load");
      await expect(page).not.toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}($|[?#])`));
      await expect(page.getByRole("heading", { name: "Taxes", exact: true })).toHaveCount(0);
    }
  });
});
