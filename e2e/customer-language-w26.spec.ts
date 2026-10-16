import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const customerFile = path.resolve("e2e/.auth/customer.json");
const ownerFile = path.resolve("e2e/.auth/owner.json");

test.describe("W-26 safely stored customer language and owner draft translations", () => {
  test("account preference is saved without bypassing Spanish publication review", async ({ browser }) => {
    test.skip(!process.env.CI || !fs.existsSync(customerFile),
      "Disposable CI authenticated customer only; never update production records.");
    const context = await browser.newContext({ storageState: customerFile });
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width: 360, height: 850 });
      await page.goto("/account/settings");
      const language = page.getByLabel("Preferred language / Idioma preferido");
      await expect(language).toBeVisible();
      await language.selectOption("es");
      await page.getByRole("button", { name: "Save language / Guardar idioma" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Language preference saved" })).toBeVisible();
      await page.reload();
      await expect(page.getByLabel("Preferred language / Idioma preferido")).toHaveValue("es");
      await expect(page.getByText(/English remains the controlling agreement/)).toBeVisible();
    } finally {
      // The shared CI customer fixture must return to its original language.
      await page.getByLabel("Preferred language / Idioma preferido").selectOption("en");
      await page.getByRole("button", { name: "Save language / Guardar idioma" }).click();
      await context.close();
    }
  });

  test("owner can inspect unpublished translation drafts without public activation", async ({ browser }) => {
    test.skip(!process.env.CI || !fs.existsSync(ownerFile),
      "Disposable CI authenticated owner only.");
    const context = await browser.newContext({ storageState: ownerFile });
    const page = await context.newPage();
    try {
      await page.goto("/desk/settings?section=notifications");
      await expect(page.getByText(/English remains the default/)).toBeVisible();
      await expect(page.getByText("Draft translations")).toBeVisible();
      await expect(page.getByRole("button", { name: "Enable reviewed Spanish" })).toBeDisabled();
      await expect(page.getByText(/Engineering surface coverage:.*Incomplete/)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
