import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

// A disposable W-22 snapshot shared by the existing waiver/terms browser
// acceptance fixtures; no new business approval or payment is inferred.
async function attachFrozenZeroOffer(
  prisma: typeof import("../src/lib/prisma").prisma,
  agreementId: string, serviceAddressId: string, signatureId: string,
) {
  const sourceFingerprint = "a".repeat(64);
  const line = { agreementId, serviceAddressId, version: 1,
    setupFeeCents: 0, downPaymentCents: 0, setupTaxCents: 0,
    allInCandidateCents: 0, jurisdictionEvidence: [] };
  const orderFingerprint = createHash("sha256").update(
    JSON.stringify({ sourceFingerprint, lines: [line] }),
  ).digest("hex");
  const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  await prisma.agreementSigningCharge.create({ data: {
    agreementId, serviceAddressId, version: 1, machineCount: 1,
    firstMonthRentCents: 4000, setupFeeCents: 0, downPaymentCents: 0,
    signingSubtotalCents: 0, setupFeeTaxTreatment: "UNDECIDED",
    settingsUpdatedAt: new Date(), sourceFingerprint, createdByUserId: ownerId,
    frozenAt: new Date(), frozenOrderFingerprint: orderFingerprint,
    frozenAllInCents: 0, frozenSetupTaxCents: 0,
    frozenChargeEvidence: {
      schemaVersion: 1, agreementId, serviceAddressId, agreementVersion: 1,
      sourceFingerprint, orderFingerprint, setupFeeCents: 0,
      downPaymentCents: 0, setupTaxCents: 0, allInCents: 0, jurisdictions: [],
    },
  } });
  await prisma.signatureRecord.update({ where: { id: signatureId }, data: {
    signingOrderFingerprint: orderFingerprint, signingAllInCents: 0,
    signingEvidenceVersion: 1,
  } });
}

test("customer signing and owner agreement show the same one-time waiver", async ({ page }, info) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const id = `waiver-${randomUUID()}`; const signatureId = `${id}-signature`;
  try {
    const address = await prisma.serviceAddress.findFirstOrThrow();
    await prisma.rentalAgreement.create({ data: { id, customerId: address.customerId, serviceAddressId: address.id, status: "AWAITING_SIGNATURE", termMonths: 12, paidInFullInAdvance: true, freeMonthGranted: true, damageWaiverCents: 1500, lines: { create: { label: "Waiver test washer", monthlyPriceCents: 4000, listPriceCents: 4500, prepayDiscountCentsPerMonth: 500 } }, signature: { create: { id: signatureId, provider: "internal" } } } });
    await attachFrozenZeroOffer(prisma, id, address.id, signatureId);
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
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId: id } });
    await prisma.rentalAgreement.deleteMany({ where: { id } });
  }
});

test("a fixed-term agreement shows its locked ending and renewal terms before the signature box", async ({ page }) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const id = `terms-${randomUUID()}`; const signatureId = `${id}-signature`;
  try {
    const address = await prisma.serviceAddress.findFirstOrThrow();
    const termsSnapshot = {
      shape: 1, source: "SYSTEM", capturedAt: "2026-10-03T00:00:00.000Z",
      termination: { feeCents: 5000, feePercent: 10, feeCapCents: 20000, noticeDays: 30, unusedTerm: "CREDIT", termsText: "Owner wording about ending early." },
      autoRenew: { noticeDays: 45, termsText: "Owner wording about renewing.", termsVersion: "ar-e2e" },
    };
    await prisma.rentalAgreement.create({ data: { id, customerId: address.customerId, serviceAddressId: address.id, status: "AWAITING_SIGNATURE", termMonths: 12, termsSnapshot, lines: { create: { label: "Terms test washer", monthlyPriceCents: 4000, listPriceCents: 4000 } }, signature: { create: { id: signatureId, provider: "internal" } } } });
    await attachFrozenZeroOffer(prisma, id, address.id, signatureId);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto(`/sign/${signatureId}`);
    const ending = page.getByRole("heading", { name: "Ending this agreement early" });
    const renewal = page.getByRole("heading", { name: "Automatic renewal" });
    await expect(ending).toBeVisible();
    await expect(renewal).toBeVisible();
    await expect(page.getByText("Notice needed to end early: 30 days.")).toBeVisible();
    await expect(page.getByText(/does not start unless it is turned on/)).toBeVisible();
    await expect(page.getByText(/opt out/i)).toHaveCount(0);
    // The disclosures come before the signing control, not after it.
    const signButton = page.getByRole("button", { name: "Sign agreement" });
    const [endingBox, renewalBox, signBox] = [await ending.boundingBox(), await renewal.boundingBox(), await signButton.boundingBox()];
    expect(endingBox!.y).toBeLessThan(signBox!.y);
    expect(renewalBox!.y).toBeLessThan(signBox!.y);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  } finally {
    await prisma.signatureRecord.deleteMany({ where: { id: signatureId } });
    await prisma.agreementSigningCharge.deleteMany({ where: { agreementId: id } });
    await prisma.rentalAgreement.deleteMany({ where: { id } });
  }
});
