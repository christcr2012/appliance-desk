import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const staffState = "e2e/.auth/staff.json";
const customerState = "e2e/.auth/customer.json";

test.describe("staff permissions", () => {
  test.use({
    storageState: fs.existsSync(staffState) ? staffState : undefined,
  });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(staffState)).toBe(true);
    test.skip(
      !fs.existsSync(staffState),
      "Requires the CI-only staff fixture.",
    );
  });

  for (const route of [
    "/desk/today",
    "/desk/activity",
    "/desk/agreements",
    "/desk/agreements?status=ACTIVE",
    "/desk/jobs/ci-security-job",
    "/desk/jobs/ci-security-job/work-order",
    "/desk/jobs",
    "/desk/dispatch",
    "/desk/driver",
    "/desk/inventory",
    "/desk/inventory/ci-security-appliance",
    "/desk/search?q=Test",
  ]) {
    test(`${route} excludes restricted fields and amounts from its server payload`, async ({
      page,
    }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      const payload = await response!.text();
      expect(payload).not.toMatch(
        /932187|782341|8675309|partsCostCents|laborCostCents|acquisitionCostCents/,
      );
      await expect(
        page.getByRole("heading", { name: "Repair cost", exact: true }),
      ).toHaveCount(0);
    });
  }

  test("customer and agreement detail use operational views", async ({
    page,
  }) => {
    await page.goto("/desk/customers");
    await page
      .getByRole("link", { name: /Test Customer/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Service addresses" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View statement" }),
    ).toHaveCount(0);
    const response = await page.request.get(page.url());
    expect(await response.text()).not.toMatch(
      /782341|remainingCents|amountCents|monthlyPriceCents/,
    );
    await page.goto("/desk/agreements");
    await page
      .getByRole("link", { name: /Test Customer/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Appliances", exact: true }),
    ).toBeVisible();
    expect(await (await page.request.get(page.url())).text()).not.toContain(
      "782341",
    );
  });

  for (const route of ["/desk/jobs", "/desk/dispatch"]) {
    test(`${route} keeps staff job access without offering scheduling`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("link", { name: /schedule a job/i })).toHaveCount(0);
      await expect(page.locator('a[href="/desk/jobs/ci-security-job"]').first()).toBeVisible();
    });
  }

  for (const route of [
    "/desk/fleet",
    "/desk/billing",
    "/desk/revenue",
    "/desk/settings",
    "/desk/agreements/new",
    "/desk/jobs/new",
    "/desk/inventory/export",
    "/desk/customers/export",
  ]) {
    test(`${route} rejects direct staff access`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/$/);
    });
  }

  test("staff can still save the operational job checklist", async ({
    page,
  }) => {
    await page.goto("/desk/jobs/ci-security-job");
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/desk/jobs/ci-security-job"),
    );
    await page.getByRole("checkbox", { name: "CI operational check" }).check();
    expect((await saved).ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Checklist (1/1)" }),
    ).toBeVisible();
    // Wait for the actual server action before reloading to confirm persistence.
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "CI operational check" }),
    ).toBeChecked();
  });

  for (const width of [360, 768, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      test(`operational job at ${width}px in ${theme} mode is accessible`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (mode) => localStorage.setItem("theme", mode),
          theme,
        );
        await page.goto("/desk/jobs/ci-security-job");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement !== document.body),
        ).toBe(true);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }
});

test.describe("customer isolation", () => {
  test.use({
    storageState: fs.existsSync(customerState) ? customerState : undefined,
  });
  test("a signed-in customer cannot retrieve another customer's invoice", async ({
    page,
  }) => {
    test.skip(
      !fs.existsSync(customerState),
      "Requires the test customer session.",
    );
    const response = await page.goto(
      "/account/billing/invoice/ci-isolation-other-invoice",
    );
    // Next's loading boundary can stream a 200 before notFound() runs.
    // Verify the denial UI and payload, rather than treating status as authorization.
    expect([200, 404]).toContain(response?.status());
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "This page could not be found.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /print/i })).toHaveCount(0);
    expect(await response!.text()).not.toMatch(/9876543|ci-other@example\.test|Other Customer/);
  });
});
