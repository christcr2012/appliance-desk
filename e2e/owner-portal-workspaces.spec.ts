import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function accessible(page: Page) {
  const layout = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("main *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth)
      .slice(0, 12)
      .map((el) => ({
        tag: el.tagName,
        classes: el.className,
        right: el.getBoundingClientRect().right,
        parent: el.parentElement?.className,
      })),
  }));
  expect(
    layout.fits,
    `Horizontal overflow at ${page.url()}: ${JSON.stringify(layout)}`,
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}
for (const role of ["owner", "customer"] as const) {
  const state = `e2e/.auth/${role}.json`;
  test.describe(`${role} focused workspaces`, () => {
    test.use({ storageState: fs.existsSync(state) ? state : undefined });
    test.beforeEach(() => {
      if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
      test.skip(
        !process.env.CI || !fs.existsSync(state),
        "Disposable CI role fixtures only",
      );
    });
    for (const width of [360, 768, 1440])
      for (const theme of ["light", "dark"]) {
        test(`sections at ${width}px ${theme}`, async ({ page }, info) => {
          test.setTimeout(90_000);
          await page.setViewportSize({ width, height: 900 });
          await page.addInitScript(
            (mode) => localStorage.setItem("theme", mode),
            theme,
          );
          const routes =
            role === "owner"
              ? [
                  "profile",
                  "service-area",
                  "products",
                  "policies",
                  "terms",
                  "pickups",
                  "jobs",
                  "website",
                  "notifications",
                  "staff",
                  "integrations",
                ]
                  .map((section) => `/desk/settings?section=${section}`)
                  .concat("/desk/billing?filter=delinquent")
                  .concat("/desk/settings/website")
                  .concat("/desk/billing?filter=deposits")
                  .concat("/desk/billing?filter=waiting")
              : [
                  "/account",
                  "/account/rentals",
                  "/account/billing",
                  "/account/maintenance?request=pickup",
                ];
          for (const route of routes) {
            await page.goto(route);
            await expect(page.locator("main h1")).toBeVisible();
            await accessible(page);
            if (route === routes[0] || route.includes("section=products")) {
              const image = info.outputPath(
                `${role}-${width}-${theme}-${route.includes("section=products") ? "products" : "home"}.png`,
              );
              await page.screenshot({ path: image, fullPage: true });
              await info.attach(
                `${role}-${width}-${theme}-${route.includes("section=products") ? "products" : "home"}`,
                {
                  path: image,
                  contentType: "image/png",
                },
              );
            }
          }
        });
      }
    if (role === "customer") {
      for (const theme of ["light", "dark"] as const) {
        test(`portal home bottom tabs at 390px ${theme}`, async ({ page }) => {
          test.setTimeout(90_000);
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(
            (mode) => localStorage.setItem("theme", mode),
            theme,
          );
          await page.goto("/account");

          const nav = page.getByRole("navigation", { name: "Account" });
          await expect(nav).toBeVisible();
          const labels = ["Home", "Rentals", "Maintenance", "Billing", "Account"];
          for (const label of labels) {
            await expect(
              nav.getByRole("link", { name: label, exact: true }),
            ).toBeVisible();
          }
          await expect(
            nav.getByRole("link", { name: "Home", exact: true }),
          ).toHaveAttribute("aria-current", "page");

          await nav.getByRole("link", { name: "Home", exact: true }).focus();
          for (const label of labels.slice(1)) {
            await page.keyboard.press("Tab");
            await expect(
              nav.getByRole("link", { name: label, exact: true }),
            ).toBeFocused();
          }

          for (const question of [
            "What do I rent?",
            "What's next?",
            "Do I owe anything?",
            "How do I get help?",
          ]) {
            await expect(
              page.getByRole("heading", { name: question, exact: true }),
            ).toBeVisible();
          }

          await accessible(page);
        });
      }
    }

    if (role === "owner") {
      test("section save survives reload and browser Back restores its selected section", async ({
        page,
      }) => {
        await page.goto("/desk/settings?section=service-area");
        const cities = page.getByLabel("Cities (comma-separated)");
        const original = await cities.inputValue();
        try {
          await cities.fill(
            [original, "CI fixture city"].filter(Boolean).join(", "),
          );
          await page.getByRole("button", { name: "Save this section" }).click();
          await expect(page.getByRole("status")).toHaveText("Settings saved.");
          await page.reload();
          await expect(cities).toHaveValue(
            [original, "CI fixture city"].filter(Boolean).join(", "),
          );
          await page
            .getByRole("navigation", { name: "Settings sections" })
            .getByRole("link", { name: "Business profile", exact: true })
            .click();
          await expect(page).toHaveURL(/section=profile$/);
          await page.goBack();
          await expect(page).toHaveURL(/section=service-area$/);
          await expect(cities).toBeVisible();
        } finally {
          await page.goto("/desk/settings?section=service-area");
          await cities.fill(original);
          await page.getByRole("button", { name: "Save this section" }).click();
          await expect(page.getByRole("status")).toHaveText("Settings saved.");
        }
      });
      test("website text: draft is private, preview shows it, publish updates the public page", async ({
        page,
        browser,
      }) => {
        test.setTimeout(120_000);
        const intro = page.locator('[id="f-how.intro"]');
        const original = "No app to download, no self-checkout — a real person reviews and handles every step.";
        const edited = "CI draft intro text for the website editor";
        const publicSeen = async () => {
          const visitor = await browser.newContext();
          try {
            const visitorPage = await visitor.newPage();
            await visitorPage.goto("/how-it-works");
            return await visitorPage.locator("main").innerText();
          } finally {
            await visitor.close();
          }
        };
        try {
          await page.goto("/desk/settings/website");
          await expect(intro).toHaveValue(original);
          await intro.fill(edited);
          await page.getByRole("button", { name: "Save draft" }).click();
          await expect(page.getByRole("status")).toContainText("Draft saved");
          // The preview shows the draft...
          const previewHref = await page
            .getByRole("link", { name: /Preview how it works/i })
            .getAttribute("href");
          await page.goto(previewHref!);
          await expect(page.locator("main")).toContainText(edited);
          // ...but a visitor still sees the old text.
          expect(await publicSeen()).toContain(original);
          expect(await publicSeen()).not.toContain(edited);
          // Publish with confirmation.
          await page.goto("/desk/settings/website");
          await page.getByRole("button", { name: "Publish…" }).click();
          await expect(page.getByRole("group", { name: "Confirm publishing" })).toContainText("How it works");
          await page.getByRole("button", { name: "Publish now" }).click();
          await expect(page.getByRole("status")).toContainText("Published");
          expect(await publicSeen()).toContain(edited);
        } finally {
          // Put the starting text back and publish it, so later tests see the original page.
          await page.goto("/desk/settings/website");
          const field = page.locator('[id="f-how.intro"]');
          if ((await field.inputValue()) !== original) {
            await field.fill(original);
            await page.getByRole("button", { name: "Save draft" }).click();
            await expect(page.getByRole("status")).toContainText("Draft saved");
            await page.getByRole("button", { name: "Publish…" }).click();
            await page.getByRole("button", { name: "Publish now" }).click();
            await expect(page.getByRole("status")).toContainText("Published");
          }
        }
        expect(await publicSeen()).toContain(original);
      });
      test("All invoices clears filter and invoice opens exact record", async ({
        page,
      }) => {
        await page.goto("/desk/billing?filter=delinquent");
        await page
          .getByRole("navigation", { name: "Filter invoices" })
          .getByRole("link", { name: "All invoices", exact: true })
          .click();
        await expect(page).toHaveURL(/\/desk\/billing$/);
        const invoice = page.locator('main a[href*="/invoice/"]').first();
        const href = await invoice.getAttribute("href");
        await invoice.click();
        await expect(page).toHaveURL(new RegExp(href! + "$"));
        await accessible(page);
        await page.goto(href!.split("/invoice/")[0]);
        await accessible(page);
      });
    } else {
      test("pickup is a confirmed review request and remains after reload", async ({
        page,
      }) => {
        await page.goto("/account");
        await page
          .getByRole("link", { name: "Request pickup", exact: true })
          .click();
        await expect(page).toHaveURL(/request=pickup$/);
        await expect(page.getByRole("status")).toContainText("does not cancel");
        await expect(page.getByLabel("What's going on?")).toHaveValue("");
        await page.getByRole("button", { name: "Submit request" }).click();
        await expect(page.getByLabel("What's going on?")).toBeFocused();
        const details = `CI fixture washer next week ${Date.now()}`;
        const text = `Pickup request: ${details}`;
        await page.getByLabel("What's going on?").fill(details);
        await page.getByRole("button", { name: "Submit request" }).click();
        // The textarea already contains this text before the save finishes.
        // Wait for the server-backed request list before testing persistence.
        const savedRequest = page.getByRole("listitem").getByText(text, { exact: true });
        await expect(savedRequest).toBeVisible();
        await page.reload();
        await expect(savedRequest).toBeVisible();
      });
    }
  });
}
