import fs from "node:fs";
import { expect, test } from "@playwright/test";

// ACC-2: a link that does not work says so plainly; the owner invites someone from Settings -> Team.
const state = "e2e/.auth/owner.json";

test("a bad invitation link shows the plain message and no form", async ({ page }) => {
  await page.goto("/join/not-a-real-link");
  await expect(page.getByText("This link no longer works")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
});

test.describe("owner invites a team member", () => {
  test.use({ storageState: fs.existsSync(state) ? state : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
    test.skip(!process.env.CI || !fs.existsSync(state), "Disposable CI role fixtures only");
  });

  test("the invitation is saved and listed, and the screen says honestly when the email was not sent", async ({ page }) => {
    const tag = `acc2-${process.pid}-${Date.now()}`;
    await page.goto("/desk/settings?section=staff");
    await expect(page.getByRole("heading", { name: "Invite a team member" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Casey Invitee");
    await page.getByLabel("Email", { exact: true }).fill(`${tag}-invitee@example.test`);
    await page.getByRole("button", { name: "Send invitation" }).click();
    // Email sending is off in CI, so the screen must not claim it was emailed.
    await expect(page.getByRole("alert").filter({ hasText: "email was not sent" })).toBeVisible();
    await expect(page.getByText("Casey Invitee").first()).toBeVisible();
  });
});
