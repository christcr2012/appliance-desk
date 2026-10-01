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
          name: "Revenue and recorded payments",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(/gross payments are not net cash or rental revenue/i),
      ).toBeVisible();
      for (const source of ["payments", "refunds"]) {
        await page
          .getByRole("navigation", { name: "Payment report source" })
          .getByRole("link", {
            name: source === "payments" ? "Gross payments" : "Invoice refunds",
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(new RegExp(`source=${source}`));
        await page
          .getByRole("navigation", { name: "Payment report period" })
          .getByRole("link", { name: "This UTC month", exact: true })
          .click();
        await expect(page).toHaveURL(/scope=month/);
        await page
          .getByRole("navigation", { name: "Payment report period" })
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
      const gross = page
        .getByRole("navigation", { name: "Payment report source" })
        .getByRole("link", { name: "Gross payments", exact: true });
      for (let tab = 0; tab < 80; tab++) {
        if (await gross.evaluate((el) => el === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(gross).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/source=payments.*scope=month/);
      await expect(
        page.getByRole("heading", {
          name: "Recorded gross invoice payments",
          exact: true,
        }),
      ).toBeVisible();
    });
  }
