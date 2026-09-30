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
    test("mobile menu contains focus, survives scrolling, closes with Escape and restores focus", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/desk/today");
      const open = page.getByRole("button", { name: "Open menu", exact: true });
      await open.click();
      const dialog = page.getByRole("dialog", { name: "Appliance Desk" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("link", { name: "Today", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      expect(await dialog.getByRole("link").count()).toBe(
        role === "owner" ? 23 : 12,
      );
      if (role === "staff") {
        await expect(
          dialog.getByRole("link", { name: "Billing", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: "Create rental", exact: true }),
        ).toHaveCount(0);
      }
      await dialog
        .getByRole("link", { name: "Activity", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() =>
          document
            .querySelector("dialog[open]")
            ?.contains(document.activeElement),
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(open).toBeFocused();
      await page.getByRole("button", { name: "More", exact: true }).click();
      await dialog.getByRole("link", { name: "Tasks", exact: true }).click();
      await expect(page).toHaveURL(/\/desk\/tasks$/);
      await expect(dialog).not.toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Quick access" })
          .getByRole("link", { name: "Tasks" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });
}

test.describe("owner daily work", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
    test.skip(!fs.existsSync(owner), "Requires isolated CI owner fixture");
  });
  for (const width of [360, 768, 1440])
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
          if (width === 360) {
            const titleBlock = await page
              .getByRole("heading", { level: 1 })
              .locator("..")
              .boundingBox();
            expect(titleBlock!.width).toBeGreaterThan(300);
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
