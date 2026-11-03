import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// PORTAL-1 (spec section 8): the redesigned customer portal, exercised
// as the seeded CI customer. Fixtures (a second property + rental, a
// delinquent Stripe bill, an open bill at the second property) are
// upserted by e2e/global-setup.ts with ci-a11y- ids. Stripe is not
// configured in this environment, so Pay now deterministically lands
// back on the bill page with ?payError=1 — the assertion is that the
// POST goes to the existing pay route and the failure surfaces the
// new way (danger toast + inline alert), never a silent dead end.

const customerFile = path.resolve("e2e/.auth/customer.json");
const ownerFile = path.resolve("e2e/.auth/owner.json");

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function accessible(page: Page) {
  await expect.poll(() => page.title(), {
    message: "The document must have a non-empty title before its accessibility scan",
    timeout: 10_000,
  }).toMatch(/\S/);
  const layout = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(layout.fits, `Horizontal overflow at ${page.url()}: ${JSON.stringify(layout)}`).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("PORTAL-1 customer portal", () => {
  test.skip(
    !process.env.CI || !fs.existsSync(customerFile),
    "Disposable CI authenticated customer only.",
  );
  test.use({ storageState: customerFile });

  test("home needs-you card posts Pay now to the existing pay route", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByText("Needs you", { exact: true })).toBeVisible();
    await expect(page.getByText(/days late/)).toBeVisible();
    const payNow = page.getByRole("button", { name: "Pay now" });
    await expect(payNow).toBeVisible();

    const posted = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/account/billing/invoice/ci-a11y-overdue/pay"),
    );
    await payNow.click();
    await posted;
    await expect(page).toHaveURL(/\/account\/billing\/invoice\/ci-a11y-overdue\?payError=1/);
    await expect(
      page.getByText("The payment page couldn't open. Try again, or call us.").first(),
    ).toBeVisible();
  });

  test("rentals sheet opens, closes with Escape and returns focus", async ({ page }) => {
    await page.goto("/account/rentals");
    const endButton = page.getByRole("button", { name: "End this rental" }).first();
    await expect(endButton).toBeVisible();
    await endButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(endButton).toBeFocused();
  });

  test("repairs deep link opens the sheet; a request with a photo submits", async ({ page }) => {
    // CI runs with no real Blob store (no repository secrets), so the two
    // Blob network legs are stubbed at the route level: the app's own token
    // request and its @vercel/blob upload() call still run, and the request
    // still submits with the uploaded photo URL. The client token is shaped
    // exactly like the real one (vercel_blob_client_<store>_<base64 wrapper
    // whose payload names the requested pathname), built from the pathname
    // the app asks for so the client's own payload checks pass. The browser-e
    // CI job configures a matching throwaway private-store identity so the
    // server accepts the stubbed URL as this customer's own upload.
    const blobStoreId = "e2eteststore";
    await page.route("**/api/uploads/photo", async (route) => {
      const body = route.request().postDataJSON() as {
        payload?: { pathname?: string };
      };
      const pathname = body.payload?.pathname ?? "maintenance-requests/test/washer.png";
      const payload = Buffer.from(
        JSON.stringify({ pathname, validUntil: Date.now() + 10 * 60 * 1000 }),
      ).toString("base64");
      const wrapped = Buffer.from(`v1.${payload}.sig`).toString("base64");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          clientToken: `vercel_blob_client_${blobStoreId}_${wrapped}`,
        }),
      });
    });
    await page.route("https://vercel.com/api/blob/**", async (route) => {
      const pathname =
        new URL(route.request().url()).searchParams.get("pathname") ??
        "maintenance-requests/test/washer.png";
      const url = `https://${blobStoreId}.private.blob.vercel-storage.com/${pathname}`;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url,
          downloadUrl: url,
          pathname,
          contentType: "image/png",
          contentDisposition: 'inline; filename="washer.png"',
          etag: "e2e-test-etag",
        }),
      });
    });
    await page.goto("/account/maintenance?request=repair");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#problem").fill("PORTAL-1 e2e: the washer hums and leaks a little.");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "washer.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });
    await expect(dialog.getByText("Photos uploaded securely.")).toBeVisible({ timeout: 20_000 });
    // Focus stays inside the sheet while it is open.
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Submit request" }).click();
    await expect(
      dialog.getByText(/We received your problem report/),
    ).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("PORTAL-1 e2e: the washer hums and leaks a little."),
    ).toBeVisible();
  });

  test("bills tabs and the property filter work from the loaded statement", async ({ page }) => {
    await page.goto("/account/billing");
    const overdue = page.locator('a[href="/account/billing/invoice/ci-a11y-overdue"]');
    const bill2 = page.locator('a[href="/account/billing/invoice/ci-a11y-bill2"]');
    // Total owed across the two open fixture bills ($42 + $61), rendered
    // in the house money format: whole dollars show no cents (formatCents).
    await expect(page.getByText("$103", { exact: true })).toBeVisible();
    await expect(overdue).toBeVisible();
    await expect(bill2).toBeVisible();

    await page.getByLabel("Property").selectOption("ci-a11y-address2");
    await expect(bill2).toBeVisible();
    await expect(overdue).toBeHidden();
    await page.getByLabel("Property").selectOption("all");
    await expect(overdue).toBeVisible();

    await page.getByRole("button", { name: /^Paid/ }).click();
    await expect(overdue).toBeHidden();
    await expect(bill2).toBeHidden();
    await expect(page.locator('a[href^="/account/billing/invoice/"]')).toHaveCount(2);
    await page.getByRole("button", { name: /^To pay/ }).click();
    await expect(overdue).toBeVisible();
  });

  test("axe and no sideways scroll across widths and themes", async ({ page }) => {
    test.setTimeout(240_000);
    for (const theme of ["light", "dark"] as const) {
      for (const width of [360, 390, 820, 1280, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (mode) => localStorage.setItem("theme", mode),
          theme,
        );
        await page.goto("/account");
        await accessible(page);
      }
      for (const width of [360, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/account/billing");
        await accessible(page);
      }
    }
  });

  test("spanish preference shows spanish chrome and spanish kit words", async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(
      !fs.existsSync(ownerFile),
      "Disposable CI authenticated owner only.",
    );
    const url = new URL(process.env.DATABASE_URL ?? "");
    test.skip(
      !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/appliance_desk_test",
      "Disposable CI database only.",
    );
    const { prisma } = await import("../src/lib/prisma");
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const customer = await prisma.customer.findFirstOrThrow({
      where: { user: { email: process.env.TEST_CUSTOMER_EMAIL! } },
    });
    const oldReview = await prisma.customerLanguageReview.findUnique({ where: { language: "es" } });
    const oldDrafts = await prisma.customerTranslationDraft.findMany();
    const ownerContext = await browser.newContext({ storageState: ownerFile });
    const context = await browser.newContext({
      storageState: customerFile,
      viewport: { width: 390, height: 844 },
    });
    const ownerPage = await ownerContext.newPage();
    const page = await context.newPage();
    try {
      // The same synthetic-review machinery W-26 uses: refresh the
      // owner drafts from the wording panel, then record a synthetic
      // review at the panel's current digest. CI only — never real
      // approval evidence.
      await ownerPage.goto("/desk/settings/features");
      const spanishSwitch = ownerPage.getByRole("switch", { name: "Spanish documents" });
      if ((await spanishSwitch.getAttribute("aria-checked")) !== "true") {
        await spanishSwitch.click();
        await expect(spanishSwitch).toHaveAttribute("aria-checked", "true");
      }
      await ownerPage.goto("/desk/settings?section=notifications");
      await ownerPage.getByRole("button", { name: /Spanish wording/ }).click();
      await expect(ownerPage.locator('form:has(input[name="kind"])').first()).toBeAttached();
      const sources = await ownerPage.locator('form:has(input[name="kind"])').evaluateAll((forms) =>
        forms.map((form) => {
          const value = (name: string) =>
            (form.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement).value;
          return { kind: value("kind"), key: value("key"), digest: value("digest"), spanish: value("spanish") };
        }),
      );
      expect(sources.length).toBeGreaterThan(20);
      for (const source of sources) {
        const spanish = source.spanish || "Texto sintético de prueba";
        await prisma.customerTranslationDraft.upsert({
          where: { sourceKind_sourceKey: { sourceKind: source.kind, sourceKey: source.key } },
          create: { sourceKind: source.kind, sourceKey: source.key, englishDigest: source.digest, spanishText: spanish, editedByUserId: owner.id },
          update: { englishDigest: source.digest, spanishText: spanish },
        });
      }
      await ownerPage.reload();
      await ownerPage.getByRole("button", { name: /Spanish wording/ }).click();
      const digest = await ownerPage.locator('input[name="expectedDigest"]').inputValue();
      const evidence = {
        copyDigest: digest,
        reviewerName: "SYNTHETIC CI ONLY",
        reviewReference: "Not actual fluent approval",
        reviewedAt: new Date(),
        legalReviewerName: "SYNTHETIC CI ONLY",
        legalReviewReference: "Not actual counsel approval",
        legalReviewedAt: new Date(),
        publishedAt: new Date(),
        publishedByUserId: owner.id,
      };
      await prisma.customerLanguageReview.upsert({
        where: { language: "es" },
        create: { language: "es", ...evidence },
        update: evidence,
      });
      await prisma.customer.update({
        where: { id: customer.id },
        data: { preferredLanguage: "es" },
      });

      // Kit words ride the same provider: hold the rentals fetch
      // (prefetches aborted so the click makes a real one) and read
      // the skeleton's spoken label while the page loads. The hold is
      // registered BEFORE the billing page loads, so no rentals
      // prefetch can complete ahead of it and make the click instant.
      await page.route("**/account/rentals**", async (route) => {
        if (route.request().headers()["next-router-prefetch"]) {
          return route.abort();
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.continue();
      });
      // The router paints the skeleton at navigation commit, not
      // while the fetch is in flight (observed directly with request
      // logging, fix cycle 6, PR #781): on a fast machine the loaded
      // page replaces it within a frame and the Cargando assertion
      // races the renderer. The one request the rentals content
      // still needs after commit is its lazy page chunk, so hold
      // chunk requests from here on: the skeleton then stays on
      // screen for the whole hold, deterministically. (The billing
      // page's own chunks are already loaded; only the rentals
      // chunk is requested after this point.)
      await page.route("**/_next/static/chunks/**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.continue();
      });

      await page.goto("/account/billing");
      await expect(
        page.getByRole("button", { name: "Datos de tarjeta o banco" }),
      ).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Facturas", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Reparaciones", exact: true })).toBeVisible();

      await nav.getByRole("link", { name: "Alquileres", exact: true }).click();
      await expect(page.getByText("Cargando…")).toBeAttached({ timeout: 8_000 });
      await expect(
        page.getByRole("heading", { name: "Alquileres", exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await page.unrouteAll({ behavior: "wait" });
    } finally {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { preferredLanguage: customer.preferredLanguage },
      });
      await prisma.customerTranslationDraft.deleteMany();
      if (oldDrafts.length) await prisma.customerTranslationDraft.createMany({ data: oldDrafts });
      if (oldReview)
        await prisma.customerLanguageReview.update({ where: { language: "es" }, data: oldReview });
      else await prisma.customerLanguageReview.deleteMany({ where: { language: "es" } });
      await context.close();
      await ownerContext.close();
    }
  });
});
