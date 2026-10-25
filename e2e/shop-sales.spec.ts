import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Shop sales and retired-appliance sales, through the real screens (disposable CI database only).
const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.describe.configure({ mode: "serial" });

const tag = randomUUID().slice(0, 8);
let prismaClient: typeof import("../src/lib/prisma")["prisma"];
let ownerId: string;
let jurisdictionId: string;
let shopLocationId: string;
let previousShopLocations: string[] = [];
let partId: string;
let applianceId: string;
let originalElection: "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS";

test.beforeAll(async () => {
  if (!enabled || !fs.existsSync(owner)) return;
  const { prisma } = await import("../src/lib/prisma");
  prismaClient = prisma;
  ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  originalElection = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { shortTermLeaseElection: true } })).shortTermLeaseElection;
  jurisdictionId = `e2e-sale-${tag}`;
  shopLocationId = `e2e-sale-loc-${tag}`;
  await prisma.taxJurisdiction.create({ data: { id: jurisdictionId, code: `E2ESALE-${tag}`, name: "E2E shop city", level: "CITY", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED" } });
  await prisma.taxRateVersion.create({ data: { jurisdictionId, rateMilliPercent: 5000, effectiveFrom: new Date("2020-01-01T07:00:00Z"), source: "MANUAL" } });
  for (const category of ["MERCHANDISE", "USED_APPLIANCE_SALE", "DELIVERY", "INSTALLATION"] as const) {
    await prisma.taxabilityRule.create({ data: { jurisdictionId, category, taxability: "TAXABLE", reason: "e2e fixture" } });
  }
  previousShopLocations = (await prisma.addressTaxLocation.findMany({ where: { forBusinessLocation: true, isCurrent: true }, select: { id: true } })).map((r) => r.id);
  await prisma.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: false } });
  await prisma.addressTaxLocation.create({ data: { id: shopLocationId, forBusinessLocation: true, isCurrent: true, status: "VERIFIED", source: "MANUAL", lookedUpAt: new Date(), jurisdictions: { create: [{ jurisdictionId }] } } });
  await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: "COLLECT_ON_RENTALS" } });

  const part = await prisma.partRecord.create({ data: { modelNumber: `E2E-SALE-${tag}`, partNumber: tag, partName: `E2E dryer hose ${tag}`, quantityOnHand: 5, sellable: true, retailPriceCents: 2500 } });
  partId = part.id;
  const type = (await prisma.applianceType.findFirst()) ?? (await prisma.applianceType.create({ data: { name: `E2E type ${tag}`, slug: `e2e-type-${tag}` } }));
  const appliance = await prisma.appliance.create({ data: { assetNumber: `E2E-${tag}`, applianceTypeId: type.id, status: "RETIRED", manufacturer: "Maytag", model: "MVWB", serialNumber: `SER${tag}` } });
  applianceId = appliance.id;
  await prisma.retiredAppliancePlan.create({ data: { applianceId, choice: "SELL", decidedAt: new Date(), decidedByUserId: ownerId } });
});

test.afterAll(async () => {
  if (!prismaClient || !shopLocationId) return;
  // Sales keep tax records that point at these rows, so the fixtures stay (tagged); only shared settings are put back.
  await prismaClient.addressTaxLocation.update({ where: { id: shopLocationId }, data: { isCurrent: false } });
  await prismaClient.addressTaxLocation.updateMany({ where: { id: { in: previousShopLocations } }, data: { isCurrent: true } });
  await prismaClient.businessSettings.update({ where: { id: "singleton" }, data: { shortTermLeaseElection: originalElection } });
});

test("ring up a part, take the cash, then take the sale back: stock goes down and comes back", async ({ page }) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database and owner fixture required");
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/desk/sales/new");
  await page.getByLabel("Item 1").selectOption(partId);
  await page.getByLabel("How many").fill("2");
  await expect(page.getByLabel("Price each ($)")).toHaveValue("25.00");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: "Save the sale" }).click();

  // $50.00 of goods at 5% tax.
  await expect(page).toHaveURL(/\/desk\/sales\/[^/]+$/);
  await expect(page.getByRole("heading", { name: /^Sale #\d+$/ })).toBeVisible();
  await expect(page.getByText("$52.50").first()).toBeVisible();
  expect((await prismaClient.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(3);

  await page.getByLabel("Amount received ($)").fill("52.50");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Nothing owed")).toBeVisible();

  await page.getByRole("button", { name: "Take this sale back…" }).click();
  await page.getByLabel("Why is it being taken back?").fill("Wrong size");
  await page.getByRole("button", { name: "Yes, refund and restock" }).click();
  await expect(page.getByText("Taken back and refunded")).toBeVisible();
  expect((await prismaClient.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(5);
});

test("sell a retired appliance: the tax warning shows, the price is not capped, and the owner closes the accountant note", async ({ page }) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database and owner fixture required");
  await page.goto("/desk/sales/new");
  await page.getByRole("button", { name: "Add a used appliance" }).click();
  await page.getByLabel("Used appliance 1").selectOption(applianceId);
  await page.getByLabel("Sale price ($)").fill("9000");
  const note = page.getByTestId("resale-tax-note");
  await expect(note).toContainText("Selling above depreciated tax basis may trigger ordinary-income depreciation recapture");
  await expect(note).toContainText("CPA review needed");
  await expect(note).toContainText("No tax estimate is shown");
  await page.getByRole("button", { name: "Save the sale" }).click();

  await expect(page).toHaveURL(/\/desk\/sales\/[^/]+$/);
  await expect(page.getByText("$9,000.00").first()).toBeVisible();
  await expect(page.getByTestId("resale-tax-note")).toContainText("CPA review needed");
  const plan = await prismaClient.retiredAppliancePlan.findUniqueOrThrow({ where: { applianceId } });
  expect(plan.doneOn).not.toBeNull();

  await page.getByRole("button", { name: "I talked to my accountant about this sale" }).click();
  await expect(page.getByText("Nothing more to follow up with your accountant on this one.")).toBeVisible();
  const saved = await prismaClient.retiredSaleDisposition.findFirstOrThrow({ where: { applianceId } });
  expect(saved.followUpDoneAt).not.toBeNull();
});
