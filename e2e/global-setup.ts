import fs from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { loginAs } from "./utils/auth";
import { completeTwoFactorSetup } from "./utils/two-factor";

// Logs in once per role (OWNER, CUSTOMER) and saves the resulting
// session to disk, so e2e/accessibility-authenticated.spec.ts's many
// tests can each start already logged in via `test.use({ storageState })`
// instead of every single test doing its own real /login round-trip in
// a beforeEach hook. That original per-test-login approach worked but
// was fragile under Playwright's default parallelism — 15 real logins
// fired in quick succession against one `next start` process on a
// modest CI runner intermittently timed out waiting for a response
// (see docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md's dated entry). Logging in twice, total, instead
// of fifteen times is both the standard Playwright pattern for this
// ("reuse signed-in state") and the actual fix.
//
// No-ops entirely if the env vars aren't set — same opt-in pattern as
// prisma/seed.ts's test-account creation; a local run without them
// just has both authenticated describe blocks skip themselves.
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";
  fs.mkdirSync("e2e/.auth", { recursive: true });
  const browser = await chromium.launch();

  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (ownerEmail && ownerPassword) {
    const page = await browser.newPage({ baseURL });
    await loginAs(page, ownerEmail, ownerPassword);
    if (new URL(page.url()).pathname === "/desk/security/setup") {
      await completeTwoFactorSetup(page, ownerPassword);
    }
    await page.context().storageState({ path: "e2e/.auth/owner.json" });
    await page.close();
  }

  const customerEmail = process.env.TEST_CUSTOMER_EMAIL;
  const customerPassword = process.env.TEST_CUSTOMER_PASSWORD;
  if (customerEmail && customerPassword) {
    const page = await browser.newPage({ baseURL });
    await loginAs(page, customerEmail, customerPassword);
    await page.context().storageState({ path: "e2e/.auth/customer.json" });
    await page.close();
  }

  const staffEmail = process.env.TEST_STAFF_EMAIL;
  const staffPassword = process.env.TEST_STAFF_PASSWORD;
  if (staffEmail && staffPassword) {
    const page = await browser.newPage({ baseURL });
    await loginAs(page, staffEmail, staffPassword);
    await page.context().storageState({ path: "e2e/.auth/staff.json" });
    await page.close();
  }

  await browser.close();
}
