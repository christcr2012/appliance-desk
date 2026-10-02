import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { loginAs } from "./utils/auth";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

test("real customer session denies direct API and protected pages after deactivation", async ({ page }) => {
  test.skip(!enabled, "Disposable CI database only");
  // Triple the default 30s budget: this test provisions its login through a
  // cold `npx tsx` child process (tsx + Prisma + Better Auth password hashing)
  // and then logs in for real, all inside the test's own timer. On a loaded
  // CI runner that setup alone can eat most of 30s — it timed out exactly
  // that way the first time it ran alongside the staff-security suite.
  test.slow();
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const email = `session-${tag}@example.test`;
  const password = `Fixture-${tag}!`;
  const customerId = `session-customer-${tag}`;
  let userId: string | undefined;
  try {
    // Public sign-up is disabled on purpose (see src/lib/auth.ts), so create the
    // login the same trusted way the app does. This runs in a child process
    // because importing Better Auth into Playwright's worker hits its separate
    // ESM loader rather than the production runtime. The script refuses to run
    // anywhere except CI's disposable database.
    userId = execFileSync(
      "npx",
      ["tsx", "scripts/create-ci-login.ts", email, password],
      { encoding: "utf8", env: process.env },
    ).trim();
    expect(userId).toBeTruthy();
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: tag } });
    await page.setViewportSize({ width: 360, height: 900 });
    await loginAs(page, email, password);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account$/);
    // Deliberately invalid upload payload: no file token/provider write occurs.
    const activeResponse = await page.request.post("/api/uploads/photo", { data: {} });
    expect([400, 503]).toContain(activeResponse.status());
    await prisma.user.update({ where: { id: userId }, data: { archivedAt: new Date() } });
    const deniedResponse = await page.request.post("/api/uploads/photo", { data: {} });
    expect(deniedResponse.status()).toBe(401);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?deactivated=1$/);
    // Restoring this owned fixture proves a valid explicit null state remains usable.
    await prisma.user.update({ where: { id: userId }, data: { archivedAt: null } });
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account$/);
  } finally {
    await prisma.customer.deleteMany({ where: { id: customerId } });
    // The UUID email is owned even if setup fails before the id is read.
    await prisma.user.deleteMany({ where: { email, ...(userId ? { id: userId } : {}) } });
  }
});
