import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

// ACC-1: a team member reaches My account from More, saves their details, is refused a wrong current password,
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

    await page.goto("/desk/more");
    await page.getByRole("link", { name: "My account" }).click();
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
});
