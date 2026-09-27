import type { Page } from "@playwright/test";

// Logs in through the real /login form — the same path a real user
// takes — rather than injecting a session cookie directly, so this also
// exercises the login form itself every time it's used. Used by
// e2e/accessibility-authenticated.spec.ts against the test-only
// OWNER/CUSTOMER accounts seeded in CI (see prisma/seed.ts) — never
// against real credentials.
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login")),
    page.getByRole("button", { name: "Log in" }).click(),
  ]);
}
