import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { businessDateKey } from "../src/lib/business-date";

const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
for (const role of ["owner", "staff"] as const) {
  const state = role === "owner" ? owner : staff;
  test.describe(`${role} desk navigation`, () => {
    test.use({ storageState: fs.existsSync(state) ? state : undefined });
    test.beforeEach(() => {
      if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
      test.skip(!fs.existsSync(state), "Requires isolated CI role fixture");
    });
    test("mobile navigation: bottom bar areas, profile menu focus, Escape and area tabs", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/desk/today");
      const mainNav = page.getByRole("navigation", { name: "Main" });
      // AR-1: the bottom bar shows all five areas for both roles (each area has
      // at least one tab the role may open; the tabs inside stay role-filtered).
      const expectedTabs = ["Today", "Customers", "Schedule", "Equipment", "Money"];
      // The Today link's accessible name carries the inbox count ("Today 26 inbox items").
      const areaLink = (label: string) =>
        label === "Today"
          ? mainNav.getByRole("link", { name: /^Today/ })
          : mainNav.getByRole("link", { name: label, exact: true });
      for (const label of expectedTabs) {
        await expect(areaLink(label)).toBeVisible();
      }
      await areaLink(expectedTabs[0]).focus();
      for (const label of expectedTabs.slice(1)) {
        await page.keyboard.press("Tab");
        await expect(areaLink(label)).toBeFocused();
      }
      // The profile menu is a sheet: restricted links are never rendered for
      // staff, Escape closes it and focus returns to the opener.
      const open = page.getByRole("button", { name: "Profile", exact: true });
      await open.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const menu = dialog.getByRole("navigation", { name: "Account and settings" });
      const expectedLinks =
        role === "owner"
          ? ["Settings", "Your account", "Website", "Business paperwork", "Privacy requests", "System health", "Activity log", "Help"]
          : ["Your account", "Activity log", "Help"];
      expect(await menu.getByRole("link").count()).toBe(expectedLinks.length);
      for (const label of expectedLinks) {
        await expect(menu.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      if (role === "staff") {
        await expect(menu.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
        await expect(menu.getByRole("link", { name: "Privacy requests", exact: true })).toHaveCount(0);
      }
      // The phone sheet is a drawer: Escape closes it and focus returns to the
      // button that opened it (the kit sheet's documented behavior).
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(open).toBeFocused();
      // Area tabs navigate within the area and the bottom bar stays put.
      await page
        .getByRole("navigation", { name: "Today sections" })
        .getByRole("link", { name: "Tasks", exact: true })
        .click();
      await expect(page).toHaveURL(/\/desk\/tasks$/);
      await expect(mainNav).toBeVisible();
    });
  });
}

test.describe("owner daily work", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
    test.skip(!fs.existsSync(owner), "Requires isolated CI owner fixture");
  });
  for (const width of [360, 390, 768, 1440])
    for (const theme of ["light", "dark"]) {
      test(`Today and Tasks at ${width}px in ${theme}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (mode) => localStorage.setItem("theme", mode),
          theme,
        );
        for (const route of ["today", "tasks"]) {
          await page.goto(`/desk/${route}`);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            route === "today" ? "Today" : "Tasks",
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          // AR-0b: Today's title shares its row with the Search and account buttons, so only Tasks keeps this check.
          if (width === 360 && route === "tasks") {
            const titleBlock = await page
              .getByRole("heading", { level: 1 })
              .locator("..")
              .boundingBox();
            expect(titleBlock!.width).toBeGreaterThan(300);
          }
          if (width === 1440 && route === "today") {
            await expect(
              page
                .getByRole("navigation", { name: "Areas" })
                .getByRole("link", { name: "Today", exact: true }),
            ).toHaveAttribute("aria-current", "page");
          }
          const axe = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          expect(axe.violations).toEqual([]);
          const screenshot = info.outputPath(`${route}-${width}-${theme}.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          await info.attach(`${route}-${width}-${theme}`, {
            path: screenshot,
            contentType: "image/png",
          });
        }
      });
    }
  test("create a due-today follow-up, find it in Today, complete it and preserve filter navigation", async ({
    page,
  }) => {
    const note = `CI follow-up ${Date.now()}`;
    await page.goto("/desk/tasks?due=today");
    await page.getByLabel("New task", { exact: true }).fill(note);
    await page
      .getByLabel("Due date (optional)")
      .fill(businessDateKey(new Date()));
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Task added.");
    await expect(
      page.getByRole("listitem").filter({ hasText: note }),
    ).toBeVisible();
    await page.goto("/desk/today");
    const row = page.getByRole("listitem").filter({ hasText: note });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Due today");
    await row.getByRole("button", { name: "Done", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.goto("/desk/tasks?due=today");
    await expect(
      page.getByRole("listitem").filter({ hasText: note }),
    ).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Filter tasks by due date" })
      .getByRole("link", { name: "Upcoming" })
      .click();
    await expect(page).toHaveURL(/due=upcoming/);
    await page.goBack();
    await expect(page).toHaveURL(/due=today/);
  });
});
