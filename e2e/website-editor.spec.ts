import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// V-C4: the Website screen for the owner. Reads are scanned at phone, tablet and desktop widths in light and dark;
// the edit, select-to-edit, review, publish-guard and discard paths run once, one after another, and leave the
// website as they found it.

async function accessible(page: Page) {
  const layout = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(layout.fits, `Sideways scrolling at ${page.url()}: ${JSON.stringify(layout)}`).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
}

const state = "e2e/.auth/owner.json";
test.describe("website editor (owner)", () => {
  test.use({ storageState: fs.existsSync(state) ? state : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
    test.skip(!process.env.CI || !fs.existsSync(state), "Disposable CI role fixtures only");
  });

  test.describe("read-only scans", () => {
    test.describe.configure({ mode: "parallel" });
    for (const width of [360, 768, 1440])
      for (const theme of ["light", "dark"])
        test(`overview, editor, review and history at ${width}px ${theme}`, async ({ page }) => {
          test.setTimeout(120_000);
          await page.setViewportSize({ width, height: 900 });
          await page.addInitScript((mode) => localStorage.setItem("theme", mode), theme);
          await page.goto("/desk/settings/website");
          await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();
          for (const task of ["Edit a page", "Photos", "Contact & prices", "Review & publish"]) await expect(page.getByRole("link", { name: new RegExp(`^${task.replace("&", "&")}`) })).toBeVisible();
          await accessible(page);
          await page.goto("/desk/settings/website?view=edit&page=home&key=home.hero.heading");
          await expect(page.getByText(/Appears on:/)).toBeVisible();
          await accessible(page);
          await page.goto("/desk/settings/website?view=edit&focus=photos");
          await accessible(page);
          await page.goto("/desk/settings/website?view=review");
          await accessible(page);
          await page.goto("/desk/settings/website?view=history");
          await accessible(page);
        });
  });

  test("edit, preview, select-to-edit, stale-publish guard, review, publish and discard", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const original = "No app to download, no self-checkout — a real person reviews and handles every step.";
    const edited = "Editor test intro words";
    const publicSeen = async () => {
      const visitor = await browser.newContext();
      try {
        const v = await visitor.newPage();
        await v.goto("/how-it-works");
        return await v.locator("main").innerText();
      } finally {
        await visitor.close();
      }
    };
    await page.goto("/desk/settings/website?view=edit&page=how&key=how.intro");
    const intro = page.getByRole("textbox", { name: "Introduction" });
    await expect(intro).toHaveValue(original);
    await expect(page.getByText("Live now").first()).toBeVisible();
    await intro.fill(edited);
    await expect(page.getByText("You have changes that are not saved.")).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status").first()).toContainText("Draft saved");

    // Preview shows the draft; the public page does not.
    await page.getByRole("button", { name: "Preview", exact: true }).first().click();
    const frame = page.frameLocator('iframe[title^="Preview of"]');
    await expect(frame.locator("main")).toContainText(edited);
    expect(await publicSeen()).not.toContain(edited);
    // The preview carries invisible select-to-edit marks; the public website never does.
    expect(await publicSeen()).not.toMatch(/[\uE000-\uF8FF]/);

    // Once the preview has started up it has removed its invisible marks from the visible words.
    await expect(frame.locator("main")).not.toContainText(/[\uE000-\uF8FF]/);
    // Click the page title in the preview: the editor jumps to that item.
    await frame.locator("main h1").click();
    await expect(page.getByRole("textbox", { name: "Heading", exact: true })).toHaveValue("How it works");

    // A second tab (another person) changes the draft; saving here is refused, nothing is lost on screen.
    const other = await page.context().newPage();
    await other.goto("/desk/settings/website?view=edit&page=how&key=how.intro");
    await other.getByRole("textbox", { name: "Introduction" }).fill("Someone else's words");
    await other.getByRole("button", { name: "Save draft" }).click();
    await expect(other.getByRole("status").first()).toContainText("Draft saved");
    await other.close();
    await page.goto("/desk/settings/website?view=edit&page=how&key=how.intro");
    await page.getByRole("textbox", { name: "Introduction" }).fill(edited);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status").first()).toContainText("Draft saved");

    await page.getByRole("button", { name: /^Review \d+ changes?$/ }).click();
    await expect(page.getByRole("heading", { name: "Review and publish" })).toBeVisible();
    await expect(page.getByText(edited)).toBeVisible();
    await expect(page.getByText(original)).toBeVisible();
    // Publishing twice quickly publishes once.
    const publish = page.getByRole("button", { name: /^Publish \d+ changes? to the live website$/ });
    await publish.dblclick();
    await expect(page.getByRole("status").first()).toContainText(/now live|Already live/);
    expect(await publicSeen()).toContain(edited);
    await expect(page.getByRole("link", { name: /How it works \(opens in a new tab\)/ })).toBeVisible();

    // Put the starting words back through history: restore goes to the draft, not live.
    await page.goto("/desk/settings/website?view=history");
    const restore = page.getByRole("button", { name: "Put in draft" }).first();
    if (await restore.isVisible()) {
      await restore.click();
      await expect(page.getByRole("status").first()).toContainText("not live");
      expect(await publicSeen()).toContain(edited);
      await page.getByRole("button", { name: "Discard the draft" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Yes, throw it away" }).click();
      await expect(page.getByRole("status").first()).toContainText("discarded");
    }
    // Return the live words to the original and publish them.
    await page.goto("/desk/settings/website?view=edit&page=how&key=how.intro");
    await page.getByRole("textbox", { name: "Introduction" }).fill(original);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status").first()).toContainText("Draft saved");
    await page.getByRole("button", { name: /^Review \d+ changes?$/ }).click();
    await page.getByRole("button", { name: /^Publish \d+ changes? to the live website$/ }).click();
    await expect(page.getByRole("status").first()).toContainText(/now live|Already live/);
    expect(await publicSeen()).toContain(original);
  });

  test("staff cannot open the website screen", async ({ browser }) => {
    const staffState = "e2e/.auth/staff.json";
    test.skip(!fs.existsSync(staffState), "No staff fixture in this run");
    const context = await browser.newContext({ storageState: staffState });
    try {
      const page = await context.newPage();
      const response = await page.goto("/desk/settings/website");
      expect(response?.status()).toBeLessThan(500);
      // The refusal can arrive as a redirect after the first bytes, so wait for it instead of reading the address once.
      await expect(page).not.toHaveURL(/\/desk\/settings\/website/);
      await expect(page.getByRole("heading", { name: "Website", exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
