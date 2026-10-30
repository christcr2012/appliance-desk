import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = path.resolve("e2e/.auth/owner.json");
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(
    !process.env.CI || !fs.existsSync(owner),
    "Uses only CI's disposable customer fixture",
  );
});
async function customerUrl(page: Page) {
  await page.goto("/desk/customers");
  const email =
    process.env.TEST_CUSTOMER_EMAIL ?? "ci-customer@example.test";
  const row = page
    .locator("main tr:visible, main li:visible")
    .filter({ hasText: email })
    .first();
  await expect(row).toBeVisible();
  const link = row.getByRole("link").first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  // The kit table's desktop row link goes through ?open=<id> (the customers
  // page sends that straight to the record); the phone card links directly.
  const open = new URL(href, "http://localhost").searchParams.get("open");
  return open ? `/desk/customers/${open}` : href;
}
for (const width of [360, 768, 1440])
  for (const theme of ["light", "dark"]) {
    test(`customer sections and leads at ${width}px in ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (mode) => localStorage.setItem("theme", mode),
        theme,
      );
      const url = await customerUrl(page);
      // AR-0b: the record's sections. Phones (below 1024 px) show Activity; desktop shows Messages instead.
      const tabs = width >= 1024
        ? ["rentals", "bills", "visits", "messages", "details"]
        : ["activity", "rentals", "bills", "visits", "details"];
      for (const tab of tabs) {
        await page.goto(`${url}?tab=${tab}`);
        await expect(
          page
            .getByRole("navigation", { name: "Customer sections" })
            .getByRole("link", { name: new RegExp(`^${tab[0].toUpperCase() + tab.slice(1)}( \\d+)?$`) }),
        ).toHaveAttribute("aria-current", "page");
        await expect(page.locator("main h1")).toBeVisible();
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
        if (tab === tabs[0] || tab === "details") {
          const image = info.outputPath(`${tab}-${width}-${theme}.png`);
          await page.screenshot({ path: image, fullPage: true });
          await info.attach(`${tab}-${width}-${theme}`, {
            path: image,
            contentType: "image/png",
          });
        }
      }
      await page.goto("/desk/leads?view=no-next-task");
      await expect(
        page.getByRole("heading", { name: "Customers", exact: true }),
      ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    });
  }
test("property action preselects its own address and history note survives navigation", async ({
  page,
}) => {
  const url = await customerUrl(page);
  await page.goto(`${url}?tab=properties`);
  const action = page
    .getByRole("link", { name: "Schedule visit here" })
    .first();
  const target = new URL(
    (await action.getAttribute("href"))!,
    "http://localhost:3000",
  );
  await action.click();
  await expect(page.getByLabel("Service address")).toHaveValue(
    target.searchParams.get("serviceAddressId")!,
  );
  await page.goto(`${url}?tab=properties`);
  const rental = page.getByRole("link", { name: "New rental here" }).first();
  const rentalTarget = new URL(
    (await rental.getAttribute("href"))!,
    "http://localhost:3000",
  );
  await rental.click();
  await expect(page.getByLabel("Service address")).toHaveValue(
    rentalTarget.searchParams.get("serviceAddressId")!,
  );
  // AR-0b: "Add a note" opens a sheet holding the same note form.
  await page.goto(`${url}?tab=activity&full=1&filter=activity`);
  const note = `CI customer history ${Date.now()}`;
  await page.getByRole("link", { name: "Add a note" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add a note" });
  await sheet.getByRole("textbox", { name: "Add a note" }).fill(note);
  await sheet.getByRole("button", { name: "Add note" }).click();
  await expect(page).toHaveURL(/\?tab=activity$/);
  // The note shows in the phone Activity section or the desktop activity column, whichever this width shows.
  await expect(page.getByText(note, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page
    .getByRole("navigation", { name: "Customer sections" })
    .getByRole("link", { name: "Details", exact: true })
    .click();
  await expect(page).toHaveURL(/\?tab=details$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?tab=activity$/);
  await expect(page.getByText(note, { exact: true }).filter({ visible: true }).first()).toBeVisible();
});
test("lead search/filter URL survives browser back and links its follow-up", async ({
  page,
}) => {
  const name = `CI inquiry ${Date.now()}`;
  await page.goto("/desk/leads/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Phone", { exact: true }).fill("9705550100");
  await page.getByRole("button", { name: "Add lead", exact: true }).click();
  // The record URL must be a real lead id — "/desk/leads/new" itself
  // matches a loose pattern, which once let this test race ahead of the
  // create action and navigate away before it committed.
  await expect(page).toHaveURL(/\/desk\/leads\/(?!new$)[^/]+$/);
  const recordUrl = page.url();
  // Log a contact from the queue so the lead sits in the Contacted stage
  // (the legacy ?view=no-next-task URL maps to that stage, LEADS.md §2).
  await page.goto(`/desk/leads?q=${encodeURIComponent(name)}`);
  const queueRow = page.locator("tbody tr").filter({ hasText: name });
  await expect(queueRow).toBeVisible();
  await queueRow.getByRole("button", { name: /More for row/ }).click();
  await page.getByRole("menuitem", { name: "Log a contact\u2026" }).click();
  await page.getByLabel("What happened").fill("Reached them by phone.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Contact logged")).toBeVisible();
  // AR-4b: the legacy queue view's row menu links into the contact sheet,
  // and browser back restores the filtered queue.
  await page.goto(
    `/desk/leads?view=no-next-task&q=${encodeURIComponent(name)}`,
  );
  const row = page.locator("tbody tr").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /More for row/ }).click();
  await page.getByRole("menuitem", { name: "Log a contact\u2026" }).click();
  await expect(page).toHaveURL(/sheet=log/);
  await page.goBack();
  await expect(page).toHaveURL(/view=no-next-task.*q=/);
  await expect(row).toBeVisible();
  await page
    .getByRole("navigation", { name: "Lead stage" })
    .getByRole("link", { name: /^Contacted/ })
    .click();
  await expect(page).toHaveURL(/stage=contacted/);
  await page.goBack();
  await expect(row).toBeVisible();
  // AR-4b record: converting without an email is refused with the reason;
  // the email is added in the What-they-want Edit sheet; then the same
  // confirmation converts and lands on the customer record.
  await page.goto(recordUrl);
  await page.getByRole("button", { name: `More for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Convert to customer\u2026" }).click();
  await expect(
    page.getByRole("heading", { name: `Make ${name} a customer?` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Convert to customer" }).click();
  await expect(page.getByText(/Add a valid email address/)).toBeVisible();
  await expect(page).toHaveURL(recordUrl);
  await page.getByRole("link", { name: "What they want" }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Email").fill(`ci-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: `More for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Convert to customer\u2026" }).click();
  await page.getByRole("button", { name: "Convert to customer" }).click();
  await expect(page).toHaveURL(/\/desk\/customers\/[^/]+$/);
});
