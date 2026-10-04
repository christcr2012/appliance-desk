import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const staff = "e2e/.auth/staff.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
test("staff shared route completes a swap and both units move together", async ({ page }, info) => {
  test.skip(!enabled || !fs.existsSync(staff), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID(); const jobId = `follow-up-${tag}`;
  const userId = `fu-user-${tag}`;
  const customerId = `fu-customer-${tag}`;
  const addressId = `fu-address-${tag}`;
  const agreementId = `fu-agreement-${tag}`;
  const ids = ["broken", "incoming", "unrelated"].map(kind => `follow-${tag}-${kind}`);
  const assets = ["BROKEN", "INCOMING", "OTHER"].map(kind => `${kind}-${tag}`);
  try {
    const type = await prisma.applianceType.findFirstOrThrow();
    await prisma.user.create({ data: { id: userId, email: `fu-${tag}@example.test`, name: "Follow Up Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `F${tag.replaceAll("-", "").slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Swap Test Way", city: "Greeley", state: "CO", zip: "80631" } });
    const agreement = await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        lines: { create: { label: "Swap fixture", monthlyPriceCents: 6000, listPriceCents: 6000 } },
      },
      include: { lines: true },
    });
    const rentalLineId = agreement.lines[0]!.id;
    await prisma.appliance.createMany({ data: ids.map((id, i) => ({ id, assetNumber: assets[i], applianceTypeId: type.id, status: i === 0 ? "MAINTENANCE" : "RESERVED", acquisitionCostCents: 932187 })) });
    // R1 requires a SWAP to inherit the actual current rental lineage rather than
    // trusting the agreement staged on the visit. Give the outgoing unit the same
    // durable assignment a real in-service appliance has.
    await prisma.applianceAssignment.create({ data: { rentalLineId, applianceId: ids[0] } });
    await prisma.job.create({
      data: {
        id: jobId,
        type: "SWAP",
        status: "IN_PROGRESS",
        customerId,
        serviceAddressId: addressId,
        agreementId,
        scheduledAt: new Date(),
        partsCostCents: 8675309,
        appliances: {
          create: ids.slice(0, 2).map((applianceId, i) => ({
            applianceId,
            role: i === 1 ? "REPLACEMENT" as const : "PRIMARY" as const,
            reservationActive: i === 1,
          })),
        },
      },
    });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/desk/driver");
    await expect(page.getByRole("heading", { name: "Shared team route" })).toBeVisible();
    const card = page.locator("div.rounded-lg.border").filter({ has: page.getByText(assets[1], { exact: false }) }).filter({ has: page.getByRole("button", { name: "Mark complete", exact: true }) });
    await card.getByRole("button", { name: "Mark complete", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/desk/jobs/${jobId}$`));
    await page.getByRole("button", { name: "Complete job", exact: true }).click();
    await expect(page.getByText("Status: COMPLETED")).toBeVisible();
    // Completing the swap moves both units itself: the new one becomes Rented, the old one goes to inspection.
    await expect.poll(async () => (await prisma.appliance.findUniqueOrThrow({ where: { id: ids[1] } })).status).toBe("RENTED");
    await page.reload();
    await expect(page.getByRole("button", { name: /Mark .* as Rented/ })).toHaveCount(0);
    const payload = await (await page.request.get(page.url())).text();
    expect(payload).not.toMatch(/partsCostCents|laborCostCents|acquisitionCostCents|932187|8675309/);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("AWAITING_INSPECTION");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: ids[2] } })).status).toBe("RESERVED");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await info.attach("staff-swap-follow-up-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, jobId, agreementId] } } });
    await prisma.staffTask.deleteMany({ where: { jobId } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: ids } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: ids } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});
