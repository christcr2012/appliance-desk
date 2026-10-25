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
    // The section scans below only read pages (no data changes), so they may run on
    // both Playwright workers at once. The tests further down that save and restore
    // settings stay in this file's normal one-after-another order.
    test.describe("read-only section scans", () => {
      test.describe.configure({ mode: "parallel" });
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
                    "/account/maintenance",
                    "/account/settings",
                  ];
            for (const route of routes) {
              await page.goto(route);
              await expect(page.locator("main h1")).toBeVisible();
              await accessible(page);
              const capture =
                role === "customer"
                  ? width !== 768
                  : route === routes[0] || route.includes("section=products");
              if (capture) {
                const routeLabel =
                  role === "customer"
                    ? route.replaceAll("/", "-").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "")
                    : route.includes("section=products")
                      ? "products"
                      : "home";
                const image = info.outputPath(
                  `${role}-${width}-${theme}-${routeLabel}.png`,
                );
                await page.screenshot({ path: image, fullPage: true });
                await info.attach(
                  `${role}-${width}-${theme}-${routeLabel}`,
                  {
                    path: image,
                    contentType: "image/png",
                  },
                );
              }
            }
          });
        }
    });
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

          const nav = page.getByRole("navigation", { name: "Main" });
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
        // ZONE-1: the service-area section is now the delivery zones form. Change only the last zone's end-of-rental
        // pickup price (nothing else reads it in the browser suite) and put it back.
        await page.goto("/desk/settings?section=service-area");
        const pickup = page.getByLabel("End-of-rental pickup ($)").last();
        const saved = page.getByText(/Delivery zones saved/);
        await expect(pickup).toBeEditable();
        const original = await pickup.inputValue();
        const changed = String(Number(original) + 1);
        try {
          await pickup.fill(changed);
          await page.getByRole("button", { name: "Save delivery zones" }).click();
          await expect(saved).toBeVisible();
          await page.reload();
          await expect(pickup).toHaveValue(changed);
          await page
            .getByRole("navigation", { name: "Settings sections" })
            .getByRole("link", { name: "Business profile", exact: true })
            .click();
          await expect(page).toHaveURL(/section=profile$/);
          await page.goBack();
          await expect(page).toHaveURL(/section=service-area$/);
          await expect(pickup).toBeVisible();
        } finally {
          await page.goto("/desk/settings?section=service-area");
          await expect(pickup).toBeEditable();
          await pickup.fill(original);
          await page.getByRole("button", { name: "Save delivery zones" }).click();
          await expect(saved).toBeVisible();
        }
      });
      test("website editor: draft is private, preview shows it, review and publish update the public page", async ({
        page,
        browser,
      }) => {
        test.setTimeout(120_000);
        const editUrl = "/desk/settings/website?view=edit&page=how&key=how.intro";
        const intro = page.getByRole("textbox", { name: "Introduction" });
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
        const publishFromEditor = async () => {
          await page.getByRole("button", { name: /^Review \d+ changes?$/ }).click();
          await expect(page.getByRole("heading", { name: "Review and publish" })).toBeVisible();
          await page.getByRole("button", { name: /^Publish \d+ changes? to the live website$/ }).click();
          await expect(page.getByRole("status").first()).toContainText("now live");
        };
        try {
          await page.goto(editUrl);
          await expect(intro).toHaveValue(original);
          await intro.fill(edited);
          await page.getByRole("button", { name: "Save draft" }).click();
          await expect(page.getByRole("status").first()).toContainText("Draft saved");
          // The preview shows the draft...
          await page.getByRole("button", { name: "Preview", exact: true }).first().click();
          await expect(page.frameLocator('iframe[title^="Preview of"]').locator("main")).toContainText(edited);
          // ...but a visitor still sees the old text.
          expect(await publicSeen()).toContain(original);
          expect(await publicSeen()).not.toContain(edited);
          await publishFromEditor();
          expect(await publicSeen()).toContain(edited);
        } finally {
          // Put the starting text back and publish it, so later tests see the original page.
          await page.goto(editUrl);
          if ((await intro.inputValue()) !== original) {
            await intro.fill(original);
            await page.getByRole("button", { name: "Save draft" }).click();
            await expect(page.getByRole("status").first()).toContainText("Draft saved");
            // Nothing to publish when the live words never changed (the draft then matches the live website).
            if (await page.getByRole("button", { name: /^Review \d+ changes?$/ }).isEnabled()) await publishFromEditor();
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
          .first()
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
