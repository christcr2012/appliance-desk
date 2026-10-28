import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { completeTwoFactorSetup, currentTotpCode } from "./utils/two-factor";

const OWNER_STATE = "e2e/.auth/owner.json";

async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

// ACC-1: a team member reaches My account from Profile, saves their details, is refused a wrong current password,
// and cannot change their password by calling the sign-in route directly (it must go through My account).
test.describe("My account", () => {
  test("a staff member saves details, is refused a wrong password, and cannot bypass the page", async ({ page }) => {
    test.skip(process.env.CI !== "true" || !process.env.DATABASE_URL, "Uses only CI's disposable local database.");
    const tag = `acc1-${process.pid}-${Date.now()}`;
    const email = `${tag}@example.test`;
    const password = "Acc1-Test-Password-2026!";
    execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/create-ci-login.ts", email, password, "STAFF"], {
      encoding: "utf8",
      env: process.env,
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/desk\/today$/);

    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("menuitem", { name: "Your account" }).click();
    await page.waitForURL(/\/desk\/account$/);
    await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("Pat Tester");
    await page.getByLabel("Mobile phone (optional)").fill("970-555-0123");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText(/Saved\./)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Pat Tester");
    await expect(page.getByLabel("Mobile phone (optional)")).toHaveValue("970-555-0123");

    await page.getByLabel("Current password", { exact: true }).first().fill("Not-The-Right-Password-1");
    await page.getByLabel("New password").fill("Another-Test-Password-2027!");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "isn't right" })).toBeVisible();

    const direct = await page.evaluate(async () => {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "x", newPassword: "y".repeat(12) }),
      });
      return response.status;
    });
    expect(direct).toBe(403);
  });

  // ACC-6: ticking "Remember this device" skips the code on that device, the device shows on My account, and
  // forgetting it asks for the code again.
  test("a remembered device skips the code, shows on My account, and can be forgotten", async ({ page }) => {
    test.skip(process.env.CI !== "true" || !process.env.DATABASE_URL, "Uses only CI's disposable local database.");
    const tag = `acc6-${process.pid}-${Date.now()}`;
    const email = `${tag}@example.test`;
    const password = "Acc6-Test-Password-2026!";
    execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/create-ci-login.ts", email, password, "STAFF"], {
      encoding: "utf8",
      env: process.env,
    });

    await loginAs(page, email, password);
    await page.waitForURL(/\/desk\/today$/);
    const { secret } = await completeTwoFactorSetup(page, password);

    // Nothing is remembered yet, so the next sign-in asks for a code and offers to remember this device.
    await page.context().clearCookies();
    await loginAs(page, email, password);
    await page.waitForURL(/\/login\/two-factor$/);
    await page.getByLabel(/Remember this device for 30 days/).check();
    await page.getByLabel("6-digit authenticator code").fill(currentTotpCode(secret));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/desk\/today$/);

    await page.goto("/desk/account");
    await expect(page.getByText("Remembered devices", { exact: true })).toBeVisible();
    await expect(page.getByText(/Remembered until/)).toBeVisible();

    // Signing out keeps the remembered device: the next password login skips the code.
    await page.getByRole("button", { name: "Sign out this device" }).click();
    await page.waitForURL(/\/login$/);
    await loginAs(page, email, password);
    await page.waitForURL(/\/desk\/today$/);

    // Forgetting asks for the code again.
    await page.goto("/desk/account");
    await page.getByRole("button", { name: "Forget remembered devices" }).click();
    // The confirm text uses a curly apostrophe (You'll), so match without it.
    await expect(page.getByText(/asked for a code next time on every device/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, forget them" }).click();
    await expect(page.getByText(/Remembered devices forgotten/)).toBeVisible();
    await expect(page.getByText("No devices remembered.")).toBeVisible();

    await page.getByRole("button", { name: "Sign out this device" }).click();
    await page.waitForURL(/\/login$/);
    await loginAs(page, email, password);
    await page.waitForURL(/\/login\/two-factor$/);
  });

  // ACC-6: the owner turns remembering off in Settings, so the login form offers nothing to remember.
  test.describe("Remember this device off", () => {
    test.use({ storageState: fs.existsSync(OWNER_STATE) ? OWNER_STATE : undefined });
    test("Remember this device is not offered when the owner turned remembering off", async ({ page, browser }) => {
      test.skip(process.env.CI !== "true" || !process.env.DATABASE_URL, "Uses only CI's disposable local database.");
      test.skip(!fs.existsSync(OWNER_STATE), "Requires the isolated CI owner fixture.");
      // page is signed in as the owner from the shared fixture.
      await page.goto("/desk/settings?section=security");
      await page.getByLabel("Remember devices for (days)").fill("0");
      // The save is a server action: wait for its POST to finish before reloading, or the reload can
      // cancel the write and the page still shows the old value.
      const turnedOff = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().includes("/desk/settings"),
      );
      await page.getByRole("button", { name: "Save remember-device rules" }).click();
      await turnedOff;
      await page.reload();
      await expect(page.getByLabel("Remember devices for (days)")).toHaveValue("0");

      const tag = `acc6-off-${process.pid}-${Date.now()}`;
      const staffEmail = `${tag}@example.test`;
      const staffPassword = "Acc6-Off-Password-2026!";
      execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/create-ci-login.ts", staffEmail, staffPassword, "STAFF"], {
        encoding: "utf8",
        env: process.env,
      });
      const staffContext = await browser.newContext();
      const staffPage = await staffContext.newPage();
      try {
        await loginAs(staffPage, staffEmail, staffPassword);
        await staffPage.waitForURL(/\/desk\/today$/);
        const { secret } = await completeTwoFactorSetup(staffPage, staffPassword);
        await staffPage.context().clearCookies();
        await loginAs(staffPage, staffEmail, staffPassword);
        await staffPage.waitForURL(/\/login\/two-factor$/);
        await expect(staffPage.getByLabel(/Remember this device/)).toHaveCount(0);
        await staffPage.getByLabel("6-digit authenticator code").fill(currentTotpCode(secret));
        await staffPage.getByRole("button", { name: "Continue" }).click();
        await staffPage.waitForURL(/\/desk\/today$/);
      } finally {
        await staffContext.close();
      }

      // The owner turns remembering back on, so later tests see the starting value.
      await page.goto("/desk/settings?section=security");
      await page.getByLabel("Remember devices for (days)").fill("30");
      const turnedOn = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().includes("/desk/settings"),
      );
      await page.getByRole("button", { name: "Save remember-device rules" }).click();
      await turnedOn;
      await page.reload();
      await expect(page.getByLabel("Remember devices for (days)")).toHaveValue("30");
    });
  });
});
