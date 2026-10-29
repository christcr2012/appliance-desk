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
    // ACC-6 records every sign-in (team and customer) in the audit log, and audit rows keep the user
    // from being deleted, so the fixture's audit rows go before the user does.
    if (userId) await prisma.auditLog.deleteMany({ where: { userId } });
    // The UUID email is owned even if setup fails before the id is read.
    await prisma.user.deleteMany({ where: { email, ...(userId ? { id: userId } : {}) } });
  }
});

test("removed team member's live session is refused on next page load and next action", async ({ page }) => {
  test.skip(!enabled, "Disposable CI database only");
  // Same cold-provisioning cost as the customer test above.
  test.slow();
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const email = `session-staff-${tag}@example.test`;
  const password = `Fixture-${tag}!`;
  let userId: string | undefined;
  try {
    userId = execFileSync(
      "npx",
      ["tsx", "scripts/create-ci-login.ts", email, password, "STAFF"],
      { encoding: "utf8", env: process.env },
    ).trim();
    expect(userId).toBeTruthy();
    await page.setViewportSize({ width: 360, height: 900 });
    await loginAs(page, email, password);
    // Signed in and active: the upload API answers as a live session, never 401.
    const activeResponse = await page.request.post("/api/uploads/photo", { data: {} });
    expect([400, 503]).toContain(activeResponse.status());
    // Removing a team member in the desk archives their user row
    // (src/domains/staff's "remove access"); do exactly that state change.
    await prisma.user.update({ where: { id: userId }, data: { archivedAt: new Date() } });
    // Next server action / API call from the still-open session: refused.
    const deniedResponse = await page.request.post("/api/uploads/photo", { data: {} });
    expect(deniedResponse.status()).toBe(401);
    // Next page load: bounced to the sign-in page, marked deactivated.
    await page.goto("/desk");
    await expect(page).toHaveURL(/\/login\?deactivated=1$/);
  } finally {
    if (userId) await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { email, ...(userId ? { id: userId } : {}) } });
  }
});

test("signing out and in as another customer never shows the first customer's data, back button included", async ({ page }) => {
  test.skip(!enabled, "Disposable CI database only");
  // Two cold-provisioned logins in one test.
  test.slow();
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const password = `Fixture-${tag}!`;
  const people = [
    { key: "first", email: `session-first-${tag}@example.test`, line1: "111 First Person Way" },
    { key: "second", email: `session-second-${tag}@example.test`, line1: "222 Second Person Way" },
  ];
  const created: {
    userId: string;
    email: string;
    customerId: string;
    addressId: string;
    agreementId: string;
    lineId: string;
    applianceId: string;
  }[] = [];
  let applianceTypeId: string | undefined;
  try {
    const type = await prisma.applianceType.create({
      data: { name: `Session Type ${tag}`, slug: `session-type-${tag}`, monthlyPriceCents: 5000 },
    });
    applianceTypeId = type.id;
    for (const person of people) {
      const userId = execFileSync(
        "npx",
        ["tsx", "scripts/create-ci-login.ts", person.email, password],
        { encoding: "utf8", env: process.env },
      ).trim();
      expect(userId).toBeTruthy();
      const customer = await prisma.customer.create({
        data: { userId, referralCode: (`SES${person.key}${tag}`).replaceAll("-", "").slice(0, 20).toUpperCase() },
      });
      const address = await prisma.serviceAddress.create({
        data: { customerId: customer.id, line1: person.line1, city: "Greeley", zip: "80631" },
      });
      const agreement = await prisma.rentalAgreement.create({
        data: { customerId: customer.id, serviceAddressId: address.id, status: "ACTIVE" },
      });
      const line = await prisma.rentalLine.create({
        data: { agreementId: agreement.id, label: "Washer", monthlyPriceCents: 5000, listPriceCents: 5000 },
      });
      const appliance = await prisma.appliance.create({
        data: { assetNumber: `SES-${person.key}-${tag}`, applianceTypeId: type.id, status: "RENTED" },
      });
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: appliance.id } });
      created.push({
        userId,
        email: person.email,
        customerId: customer.id,
        addressId: address.id,
        agreementId: agreement.id,
        lineId: line.id,
        applianceId: appliance.id,
      });
    }
    await page.setViewportSize({ width: 360, height: 900 });
    await loginAs(page, people[0].email, password);
    await page.goto("/account");
    await expect(page.getByText(people[0].line1).first()).toBeVisible();
    // Sign out through the same Better Auth endpoint the app's own
    // sign-out control calls (src/components/account-shell.tsx).
    await page.request.post("/api/auth/sign-out");
    await loginAs(page, people[1].email, password);
    await page.goto("/account");
    await expect(page.getByText(people[1].line1).first()).toBeVisible();
    await expect(page.getByText(people[0].line1)).toHaveCount(0);
    // Walk history back: no step may resurrect the first customer's page,
    // whether the browser refetches it (session now belongs to person two)
    // or restores it from its back/forward cache.
    for (let step = 0; step < 4; step += 1) {
      await page.goBack().catch(() => null);
      const content = await page.content();
      expect(content).not.toContain(people[0].line1);
      if (!page.url().includes("/account")) break;
    }
  } finally {
    for (const entry of [...created].reverse()) {
      await prisma.applianceAssignment.deleteMany({ where: { rentalLineId: entry.lineId } });
      await prisma.rentalLine.deleteMany({ where: { id: entry.lineId } });
      await prisma.rentalAgreement.deleteMany({ where: { id: entry.agreementId } });
      await prisma.appliance.deleteMany({ where: { id: entry.applianceId } });
      await prisma.serviceAddress.deleteMany({ where: { id: entry.addressId } });
      await prisma.customer.deleteMany({ where: { id: entry.customerId } });
      await prisma.auditLog.deleteMany({ where: { userId: entry.userId } });
      await prisma.user.deleteMany({ where: { email: entry.email, id: entry.userId } });
    }
    if (applianceTypeId) await prisma.applianceType.deleteMany({ where: { id: applianceTypeId } });
  }
});
