import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { loginAs } from "./utils/auth";
import { completeTwoFactorSetup } from "./utils/two-factor";

// LD-1 review (Codex P1): the lead detail page admitted STAFF but called the
// OWNER/ADMIN-only task read unconditionally, so a staff member could see the
// leads list but not open any record. This spec proves a staff member whose
// job role includes Leads can open a lead — and that the follow-up tasks
// section (owner/admin only) stays hidden for them instead of breaking the page.
const url = new URL(
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/appliance_desk_test",
);
const disposable =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

test.describe.configure({ mode: "serial" });

let leadId = "";
let staffEmail = "";
let staffPassword = "";
let contactName = "";
let cleanup: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
  test.skip(!disposable, "Needs the disposable CI database.");
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  staffEmail = `lead-staff-${tag}@example.test`;
  staffPassword = `Fixture-${tag}!`;
  contactName = `Staff lead ${tag.slice(0, 8)}`;
  const staffId = execFileSync(
    "npx",
    ["tsx", "scripts/create-ci-login.ts", staffEmail, staffPassword, "STAFF"],
    { encoding: "utf8", env: process.env },
  ).trim();
  const role = await prisma.jobRole.create({
    data: { label: `Leads ${tag}`, accessLevel: "STAFF", screens: ["leads", "customers"] },
  });
  await prisma.user.update({ where: { id: staffId }, data: { jobRoleId: role.id } });
  const lead = await prisma.lead.create({
    data: {
      contactName,
      phone: "9705550134",
      phoneDigits: "9705550134",
      email: `lead-staff-${tag}@example.com`,
      emailLower: `lead-staff-${tag}@example.com`,
      status: "NEW",
    },
  });
  leadId = lead.id;
  cleanup = async () => {
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.user.update({ where: { id: staffId }, data: { archivedAt: new Date() } });
    await prisma.jobRole.deleteMany({ where: { id: role.id } });
  };
});

test.afterAll(async () => {
  await cleanup?.();
});

test("a staff member with the Leads screen can open a lead", async ({ page }) => {
  await loginAs(page, staffEmail, staffPassword);
  if (new URL(page.url()).pathname === "/desk/security/setup") {
    await completeTwoFactorSetup(page, staffPassword);
  }
  await page.goto(`/desk/leads/${leadId}`);
  await expect(page.getByText(contactName).first()).toBeVisible();
  // The follow-up tasks section is owner/admin only; staff must not see it,
  // and its absence must not break the page.
  await expect(page.getByText("Follow-up tasks")).toHaveCount(0);
});
