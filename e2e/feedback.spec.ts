import fs from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

// MCP-10a: the whole people-only loop in a real browser. A customer reports a problem (with a large screenshot that
// is shrunk in the browser) from a rental page and sees "Received"; the owner sees the To do, asks a question; the
// customer answers; the owner marks it Fixed with a reason; the customer reopens it. Axe at phone and desktop widths,
// light and dark, and the form is sent with the keyboard only.
const owner = "e2e/.auth/owner.json";
const customerState = "e2e/.auth/customer.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";

test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

test("app feedback: send, question, answer, fixed, reopen", async ({ page, browser }) => {
  test.skip(!enabled || !fs.existsSync(customerState), "Disposable Postgres and saved owner/customer sessions required.");
  test.setTimeout(180_000);
  const tag = randomUUID().slice(0, 8);
  const title = `Rental page button ${tag}`;
  const { prisma } = await import("../src/lib/prisma");
  const customerContext = await browser.newContext({ storageState: customerState });
  const customer = await customerContext.newPage();
  // About 3 MB of noise: far over the 900 KB the server accepts, so it only gets through after the browser shrinks it.
  const bigPng = await sharp({
    create: { width: 1100, height: 950, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } },
  }).png().toBuffer();
  expect(bigPng.byteLength).toBeGreaterThan(2_500_000);

  try {
    // 1. The customer reports a problem from a rental page, keyboard only.
    await customer.goto("/account/rentals");
    await customer.getByRole("link", { name: "App feedback" }).click();
    await expect(customer).toHaveURL(/\/account\/feedback\/new\?from=%2Faccount%2Frentals/);
    await expect(customer.getByRole("heading", { name: "Tell us about the app" })).toBeVisible();
    await expect(customer.getByText("This is for problems with this website or app.")).toBeVisible();
    await expect(customer.getByRole("link", { name: "Request a repair" })).toHaveAttribute("href", "/account/maintenance?request=repair");
    await expect(customer.getByText("Page: My account › Rentals")).toBeVisible();
    await customer.getByLabel("Add screenshots").setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: bigPng });
    await expect(customer.getByText("screen.png")).toBeVisible({ timeout: 20_000 });
    await customer.getByLabel("What happened?").focus();
    await customer.keyboard.type(title);
    await customer.keyboard.press("Tab");
    await expect(customer.getByLabel("Tell us more")).toBeFocused();
    await customer.keyboard.type("The Pay button on my rental page does nothing.");
    await customer.getByRole("button", { name: "Send" }).focus();
    await customer.keyboard.press("Enter");
    await expect(customer.getByRole("heading", { name: /Thanks — report #\d+ was sent\. We'll answer here\./ })).toBeVisible({ timeout: 30_000 });
    const sent = await prisma.feedbackReport.findFirstOrThrow({ where: { title } });
    expect(sent).toMatchObject({ routeTemplate: "/account/rentals", aiReview: "HUMAN_ONLY", state: "SUBMITTED" });
    const pictures = await prisma.feedbackAttachment.count({ where: { reportId: sent.id } });
    if (pictures === 0) {
      // No private picture store in this disposable environment: the report is still sent and the person is told.
      await expect(customer.getByText("Your report was sent, but pictures can't be saved right now.")).toBeVisible();
    }
    await customer.getByRole("link", { name: "See my reports" }).click();
    const card = customer.getByRole("link", { name: new RegExp(title) });
    await expect(card).toContainText("Received");

    // 2. The owner sees the To do and asks a question.
    await page.goto("/desk/today");
    await expect(page.getByText(`App feedback #${sent.number}: ${title}`).first()).toBeVisible();
    await page.goto(`/desk/feedback/${sent.id}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: "Reply" }).click();
    await page.getByLabel("Message to them").fill("Which rental were you looking at?");
    await page.getByLabel("and mark as").selectOption({ label: "Waiting on them" });
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Reply sent.")).toBeVisible();

    // 3. The customer answers.
    await customer.goto(`/account/feedback/${sent.id}`);
    await expect(customer.getByText("We have a question").first()).toBeVisible();
    await expect(customer.getByText("Which rental were you looking at?")).toBeVisible();
    await customer.getByLabel("Your answer").fill("The washer rental.");
    await customer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(customer.getByText("Sent. We'll answer here.")).toBeVisible();

    // 4. The owner marks it Fixed, with a reason.
    await page.reload();
    await expect(page.getByText("They answered").first()).toBeVisible();
    await page.getByRole("button", { name: "Change status…" }).click();
    await page.getByLabel("New status").selectOption({ label: "Fixed" });
    await page.getByLabel("Reason (required)").fill("Fixed the Pay button");
    await page.getByRole("button", { name: "Yes, change it" }).click();
    await expect(page.getByText("Status changed.")).toBeVisible();

    // 5. The customer reopens it.
    await customer.reload();
    await expect(customer.getByText("Fixed").first()).toBeVisible();
    await customer.getByLabel("What is still wrong?").fill("It still does nothing on my phone.");
    await customer.getByRole("button", { name: "Reopen this report" }).click();
    await expect(customer.getByText("Your report was reopened.")).toBeVisible();
    await customer.reload();
    await expect(customer.getByText("Being looked at").first()).toBeVisible();

    // 6. Accessibility of the two record pages (light and dark, phone and desktop).
    await scanAccessibilityRoute(customer, { path: "/account/feedback/[id]", role: "CUSTOMER", fixture: `/account/feedback/${sent.id}` });
    await scanAccessibilityRoute(page, { path: "/desk/feedback/[id]", role: "OWNER", fixture: `/desk/feedback/${sent.id}` });
  } finally {
    await customerContext.close();
    await prisma.feedbackReport.deleteMany({ where: { title: { contains: tag } } });
  }
});

test("staff can send app feedback but can't open the owner's feedback list", async ({ browser }) => {
  const staffState = "e2e/.auth/staff.json";
  test.skip(!enabled || !fs.existsSync(staffState), "Disposable Postgres and saved staff session required.");
  const context = await browser.newContext({ storageState: staffState });
  try {
    const staff = await context.newPage();
    await staff.goto("/desk/feedback");
    await expect(staff).not.toHaveURL(/\/desk\/feedback$/);
    await staff.goto("/desk/feedback/new?from=/desk/today");
    await expect(staff.getByRole("heading", { name: "Tell us about the app" })).toBeVisible();
    await expect(staff.getByRole("link", { name: "Open repairs" })).toHaveAttribute("href", "/desk/maintenance");
  } finally {
    await context.close();
  }
});
