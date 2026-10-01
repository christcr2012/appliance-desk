import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(
    !process.env.CI || !fs.existsSync(owner),
    "Disposable CI business fixture only",
  );
});
test("new rental customer address has keyboard-accessible labels and persists", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/desk/agreements/new");
  await page.getByRole("radio", { name: "New customer", exact: true }).check();
  await page.getByLabel("Name", { exact: true }).fill("CI labelled address");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`address-${Date.now()}@example.test`);
  await page
    .getByLabel("Street address", { exact: true })
    .fill("123 Labelled Lane");
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Apartment / unit (optional)", { exact: true }),
  ).toBeFocused();
  await page.keyboard.type("Unit 7");
  await page.getByLabel("City", { exact: true }).fill("Greeley");
  await page.getByLabel("State", { exact: true }).fill("CO");
  await page.getByLabel("ZIP", { exact: true }).fill("80631");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await info.attach("rental-address-phone", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "Next: term & fees" }).click();
  await expect(page.getByLabel("Term (months, optional)")).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Customer saved, but the setup email was not sent" }),
  ).toBeVisible();
  const href = await page
    .getByRole("link", { name: "customer record", exact: true })
    .getAttribute("href");
  expect(href).toMatch(/^\/desk\/customers\//);
  await page.goto(`${href}?tab=properties`);
  await page.reload();
  await expect(page.getByText(/123 Labelled Lane/).first()).toBeVisible();
  await expect(page.getByText(/Unit 7/).first()).toBeVisible();
});
