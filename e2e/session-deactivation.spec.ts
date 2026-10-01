import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { loginAs } from "./utils/auth";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

test("real customer session denies direct API and protected pages after deactivation", async ({ page }) => {
  test.skip(!enabled, "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const email = `session-${tag}@example.test`;
  const password = `Fixture-${tag}!`;
  const customerId = `session-customer-${tag}`;
  let userId: string | undefined;
  try {
    // Exercise the running app; importing Better Auth into Playwright's
    // worker hits its separate ESM loader rather than the production runtime.
    const response = await page.request.post("/api/auth/sign-up/email", {
      data: { email, password, name: "Session fixture" },
      headers: { Origin: "http://localhost:3000" },
    });
    expect(response.ok()).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userId = user.id;
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
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
