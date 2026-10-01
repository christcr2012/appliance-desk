import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
const owner = path.resolve("e2e/.auth/owner.json");
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(!process.env.CI || !fs.existsSync(owner), "Disposable CI business fixture only");
});
for (const width of [360, 1280]) {
  test(`work order excludes desk chrome and padding when printing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/desk/jobs/ci-security-job/work-order");
    await expect(page.getByText("CI operational check", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print work order" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.locator("header")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Quick access", includeHidden: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print work order", includeHidden: true })).toBeHidden();
    await expect(page.getByText("CI operational check", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toHaveCSS("padding-left", "0px");
    await expect(page.locator("main")).toHaveCSS("padding-bottom", "0px");
    await info.attach(`work-order-print-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}
