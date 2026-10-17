import { expect, test, type Page } from "@playwright/test";

// V-3: the inner public pages share one bold opening. They must never scroll sideways, in either theme at the three
// design widths, and the one h1 must be the band's heading. (Every public route's accessibility scan already runs in the
// generated route scans; this checks the layout promises of the new look.)

const PAGES = ["/how-it-works", "/service-area", "/contact", "/launch"];

async function theme(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => {
    localStorage.setItem("theme", m);
    document.documentElement.classList.toggle("dark", m === "dark");
    document.documentElement.style.colorScheme = m;
  }, mode);
}

test.describe("signature public pages", () => {
  for (const path of PAGES) {
    for (const mode of ["light", "dark"] as const) {
      test(`${path} has the evergreen band and no sideways scrolling at 360, 768 and 1440 in ${mode} mode`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(path, { waitUntil: "load" });
        await theme(page, mode);
        for (const width of [360, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          // Measured once the new width has been laid out: the page must settle to no sideways scroll, and stay there.
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${path} at ${width}px`, timeout: 5000 })
            .toBeLessThanOrEqual(0);
        }
        await expect(page.locator("main .cut-band").first()).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        const heading = page.getByRole("heading", { level: 1 });
        await expect(heading).toBeVisible();
        const inBand = await heading.evaluate((el) => Boolean(el.closest(".cut-band")));
        expect(inBand).toBe(true);
      });
    }
  }

  test("a link inside the band keeps a complete keyboard focus ring (the clip is lifted while focused)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/service-area", { waitUntil: "load" });
    const band = page.locator("main .cut-band").first();
    const before = await band.evaluate((el) => getComputedStyle(el).clipPath);
    expect(before).not.toBe("none");
    // Tab from the top until focus lands on something inside the page's own content, then check the clip rule is applied
    // to any band that holds focus.
    const clipFocus = await page.evaluate(() => {
      const probe = document.createElement("a");
      probe.href = "#probe";
      probe.textContent = "probe";
      document.querySelector("main .cut-band")?.appendChild(probe);
      probe.focus();
      const band = probe.closest(".cut-band") as HTMLElement;
      const value = getComputedStyle(band).clipPath;
      probe.remove();
      return value;
    });
    expect(clipFocus).toBe("none");
  });
});
