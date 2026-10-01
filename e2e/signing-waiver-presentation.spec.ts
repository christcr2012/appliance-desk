import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test("customer signing and owner agreement show the same one-time waiver", async ({ page }, info) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const id = `waiver-${randomUUID()}`; const signatureId = `${id}-signature`;
  try {
    const address = await prisma.serviceAddress.findFirstOrThrow();
    await prisma.rentalAgreement.create({ data: { id, customerId: address.customerId, serviceAddressId: address.id, status: "AWAITING_SIGNATURE", termMonths: 12, paidInFullInAdvance: true, freeMonthGranted: true, damageWaiverCents: 1500, lines: { create: { label: "Waiver test washer", monthlyPriceCents: 4000, listPriceCents: 4500, prepayDiscountCentsPerMonth: 500 } }, signature: { create: { id: signatureId, provider: "internal" } } } });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto(`/sign/${signatureId}`);
    await expect(page.getByText("Damage waiver: $15 once at signing", { exact: true })).toBeVisible();
    await expect(page.getByText("Total: $40/month", { exact: true })).toBeVisible();
    await expect(page.getByText(/Damage waiver:.*\/month/)).toHaveCount(0);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await info.attach("one-time-waiver-signing-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto(`/desk/agreements/${id}`);
    await expect(page.getByText(/Damage waiver \$15 once at signing/)).toBeVisible();
    await expect(page.getByText(/Damage waiver \$15\/mo/)).toHaveCount(0);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id } })).status).toBe("AWAITING_SIGNATURE");
  } finally {
    await prisma.signatureRecord.deleteMany({ where: { id: signatureId } });
    await prisma.rentalAgreement.deleteMany({ where: { id } });
  }
});
