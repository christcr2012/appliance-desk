import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(
    !process.env.CI || !fs.existsSync(owner),
    "Disposable CI owner only",
  );
});

for (const width of [360, 768, 1440])
  for (const theme of ["light", "dark"]) {
    test(`revenue definitions and source filters at ${width}px ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (mode) => localStorage.setItem("theme", mode),
        theme,
      );
      await page.goto("/desk/revenue");

      await expect(
        page.getByRole("heading", {
          name: "Revenue and cash activity",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          /real cash receipts, invoice allocations and refunds are tracked separately/i,
        ),
      ).toBeVisible();
      await expect(
        page.getByText(/gross cash received comes from Receipt records/i),
      ).toBeVisible();

      for (const source of ["payments", "refunds"]) {
        await page
          .getByRole("navigation", { name: "Invoice ledger source" })
          .getByRole("link", {
            name:
              source === "payments" ? "Cash received" : "Invoice refunds",
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(new RegExp(`source=${source}`));
        await page
          .getByRole("navigation", { name: "Invoice ledger period" })
          .getByRole("link", { name: "This month (Colorado)", exact: true })
          .click();
        await expect(page).toHaveURL(/scope=month/);
        await page
          .getByRole("navigation", { name: "Invoice ledger period" })
          .getByRole("link", { name: "All recorded dates", exact: true })
          .click();
        await expect(page).toHaveURL(/scope=all/);

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

        const image = info.outputPath(
          `revenue-${source}-${width}-${theme}.png`,
        );
        await page.screenshot({ path: image, fullPage: true });
        await info.attach(`revenue-${source}-${width}-${theme}`, {
          path: image,
          contentType: "image/png",
        });
      }

      await page.reload();
      await expect(page).toHaveURL(/source=refunds.*scope=all/);
      await page.goBack();
      await expect(page).toHaveURL(/source=refunds.*scope=month/);

      const allocations = page
        .getByRole("navigation", { name: "Invoice ledger source" })
        .getByRole("link", { name: "Cash received", exact: true });
      // After "back" the address changes before the page content does. Wait until the
      // links on screen belong to the month view, or Enter can follow a stale link.
      await expect(allocations).toHaveAttribute("href", /scope=month/);
      for (let tab = 0; tab < 80; tab++) {
        if (await allocations.evaluate((el) => el === document.activeElement)) {
          break;
        }
        await page.keyboard.press("Tab");
      }
      await expect(allocations).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/source=payments.*scope=month/);
      await expect(
        page.getByRole("heading", {
          name: "Cash received (one row per payment)",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(/Each payment appears once, even when one check paid several/i),
      ).toBeVisible();
    });
  }
