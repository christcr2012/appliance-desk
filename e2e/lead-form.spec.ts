import { test, expect } from "@playwright/test";

// Exercises the real public lead-capture flow end-to-end against the
// built app and a real (throwaway, in CI) database — not a mock. See
// docs/BUSINESS-RULES.md for the fields this form must capture.
test("submitting the quote form creates a lead and shows a success message", async ({
  page,
}) => {
  await page.goto("/contact");

  await page.getByLabel("Your name").fill("Jamie Test");
  await page.getByLabel("Phone number").fill("303-555-0100");
  await page.getByLabel("Email").fill("jamie@example.com");

  // Select whichever published appliance type appears first — the
  // catalog is seeded data (prisma/seed.ts), not hard-coded here.
  await page.getByRole("checkbox").first().check();

  await page
    .getByLabel(/I agree to the/)
    .check();

  await page.getByRole("button", { name: "Request a quote" }).click();

  await expect(
    page.getByRole("heading", { name: /Thanks — we've got your request/ }),
  ).toBeVisible();
});

test("submitting without required fields shows validation errors, not a crash", async ({
  page,
}) => {
  await page.goto("/contact");

  await page.getByRole("button", { name: "Request a quote" }).click();

  await expect(page.getByText("Enter your name")).toBeVisible();
  await expect(
    page.getByText("You must agree to the privacy policy and terms to continue"),
  ).toBeVisible();
});
