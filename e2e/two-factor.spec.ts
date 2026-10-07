import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  completeTwoFactorSetup,
  currentTotpCode,
} from "./utils/two-factor";

test.describe("two-step login", () => {
  test("enrolls an Admin, requires TOTP on the next login, and consumes a backup code once", async ({ page }) => {
    test.skip(
      process.env.CI !== "true" || !process.env.DATABASE_URL,
      "Uses only CI's disposable local database.",
    );
    const tag = `g2-${process.pid}-${Date.now()}`;
    const email = `${tag}@example.test`;
    const password = "G2-Test-Password-2026!";
    execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", "scripts/create-ci-login.ts", email, password, "ADMIN"],
      { encoding: "utf8", env: process.env },
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/desk\/security\/setup$/);

    const { secret, backupCodes } = await completeTwoFactorSetup(page, password);
    const backupCode = backupCodes[0]!;

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/login\/two-factor$/);
    await page.getByLabel("6-digit authenticator code").fill(currentTotpCode(secret));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/desk\/today$/);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/login\/two-factor$/);
    await page.getByRole("button", { name: "Backup code" }).click();
    await page.getByLabel("Single-use backup code").fill(backupCode);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/desk\/today$/);

    // Prove the same backup code cannot be consumed twice without doing a
    // fourth rapid password login, which would correctly trip the sign-in
    // rate limiter and test throttling rather than backup-code semantics.
    const reused = await page.evaluate(async (code) => {
      const response = await fetch("/api/auth/two-factor/verify-backup-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          trustDevice: false,
        }),
      });
      return {
        status: response.status,
        body: await response.text(),
      };
    }, backupCode);
    expect(reused.status).toBe(401);
    expect(reused.body).toMatch(/backup code/i);
  });
});
