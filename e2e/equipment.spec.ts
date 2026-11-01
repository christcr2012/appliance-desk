import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

/**
 * AR-6 (EQUIPMENT.md sections 3-4): the Fleet list's tabs, the appliance
 * record, and retiring through the confirmation dialog. Self-seeded like
 * inventory-bulk-feedback.spec.ts; the staff case proves the operational
 * record carries no money or retire controls.
 *
 * AR-6b (sections 5-7): the Purchases page's two views with the old
 * orders URL redirecting into the orders view, the owner low-stock Parts
 * view with its Selling column and Adjust stock sheet, and staff seeing
 * Parts stock with no prices and no edit controls at all.
 */
test.describe("equipment — owner", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.skip(!enabled, "Disposable CI database only");

  test("owner filters Ready to rent, opens a record, and retires with a reason", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated owner fixture required");
    const { prisma } = await import("../src/lib/prisma");
    const tag = randomUUID().slice(0, 8);
    const readyAsset = `CI-EQ-${tag}-ready`;
    const outAsset = `CI-EQ-${tag}-out`;
    const type = await prisma.applianceType.findFirstOrThrow();
    const ids = [`eq-${tag}-ready`, `eq-${tag}-out`];
    try {
      await prisma.appliance.createMany({
        data: [
          { id: ids[0], assetNumber: readyAsset, applianceTypeId: type.id, status: "AVAILABLE" },
          { id: ids[1], assetNumber: outAsset, applianceTypeId: type.id, status: "RENTED" },
        ],
      });
      await page.goto("/desk/inventory?status=ready");
      await expect(page.getByRole("link", { name: new RegExp(readyAsset) })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(outAsset) })).toHaveCount(0);

      await page.getByRole("link", { name: new RegExp(readyAsset) }).first().click();
      await expect(page).toHaveURL(new RegExp(`/desk/inventory/${ids[0]}`));
      await expect(page.getByText("In service since")).toBeVisible();

      await page.getByRole("button", { name: "Retire…" }).click();
      await page.getByLabel("Why is it being retired?").fill("CI: motor failed");
      await page.getByRole("button", { name: "Retire it" }).click();
      // The retire action + refresh land asynchronously: the Retire…
      // button unmounts only once the refreshed record reads RETIRED.
      // (A bare "Retired" text match would hit the sidebar link instantly
      // and race the action — rehearsal on the Workshop bench caught it.)
      await expect(page.getByRole("button", { name: "Retire…" })).toHaveCount(0, { timeout: 15_000 });
      const row = await prisma.appliance.findUniqueOrThrow({ where: { id: ids[0] } });
      expect(row.status).toBe("RETIRED");
    } finally {
      await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
    }
  });

  test("owner switches between appliance purchases and parts orders; the old orders URL redirects", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated owner fixture required");
    const { prisma } = await import("../src/lib/prisma");
    const tag = randomUUID().slice(0, 8);
    const seller = `CI Seller ${tag}`;
    const type = await prisma.applianceType.findFirstOrThrow();
    const ownerUser = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const supplierId = `sup-${tag}`;
    const purchaseId = `pur-${tag}`;
    const orderId = `ord-${tag}`;
    const applianceId = `eq-${tag}-bought`;
    try {
      await prisma.supplier.create({
        data: { id: supplierId, name: seller, contactName: "CI Contact" },
      });
      await prisma.purchase.create({
        data: {
          id: purchaseId,
          operationKey: `ci-${tag}`,
          payloadHash: `ci-${tag}`,
          supplierId,
          sellerName: seller,
          purchasedOn: new Date("2026-10-01T12:00:00Z"),
          subtotalCents: 50000,
          sellerTaxCents: 0,
          sellerTaxKind: "UNKNOWN",
          createdByUserId: ownerUser.id,
          taxRevisionAt: new Date("2026-10-01T12:00:00Z"),
        },
      });
      await prisma.appliance.create({
        data: {
          id: applianceId,
          assetNumber: `CI-EQ-${tag}-bought`,
          applianceTypeId: type.id,
          status: "AVAILABLE",
          purchaseId,
          acquisitionCostCents: 50000,
          acquisitionTaxStatus: "UNKNOWN",
        },
      });
      await prisma.purchaseOrder.create({
        data: { id: orderId, supplierId, status: "DRAFT", createdByUserId: ownerUser.id },
      });

      // The old orders list URL lands on the Purchases page, orders view.
      await page.goto("/desk/purchase-orders");
      await expect(page).toHaveURL(/\/desk\/purchases\?view=orders/);
      await expect(page.getByRole("link", { name: new RegExp(seller) })).toBeVisible();

      // Switch to appliance purchases: the receipt row and its tax flag.
      await page.getByRole("link", { name: "Appliance purchases" }).click();
      await expect(page).toHaveURL(/\/desk\/purchases\?view=purchases$/);
      await expect(page.getByRole("link", { name: new RegExp(seller) })).toBeVisible();
      await expect(page.getByText("Tax question")).toBeVisible();
    } finally {
      await prisma.appliance.deleteMany({ where: { id: applianceId } });
      await prisma.purchaseOrder.deleteMany({ where: { id: orderId } });
      await prisma.purchase.deleteMany({ where: { id: purchaseId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
    }
  });

  test("owner sees the Selling column on low stock and opens Adjust stock", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated owner fixture required");
    const { prisma } = await import("../src/lib/prisma");
    const tag = randomUUID().slice(0, 8);
    const partName = `CI pump ${tag}`;
    const partId = `part-${tag}`;
    const type = await prisma.applianceType.findFirstOrThrow();
    try {
      await prisma.partRecord.create({
        data: {
          id: partId,
          modelNumber: `CI-M-${tag}`,
          partNumber: `CI-P-${tag}`,
          partName,
          applianceTypeId: type.id,
          quantityOnHand: 1,
          reorderThreshold: 3,
          sellable: true,
          retailPriceCents: 2599,
          resaleUnitsOnHand: 1,
          resaleCostOnHandCents: 1000,
        },
      });
      await page.goto("/desk/parts?status=low");
      await expect(page.getByRole("link", { name: new RegExp(partName) })).toBeVisible();
      await expect(page.getByText("$25.99")).toBeVisible();
      await page.getByRole("button", { name: `More for ${partName}` }).click();
      await page.getByRole("menuitem", { name: "Adjust stock…" }).click();
      // The sheet opens the stock panel straight into its settings form.
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByLabel("On hand")).toBeVisible();
    } finally {
      await prisma.partRecord.deleteMany({ where: { id: partId } });
    }
  });
});

test.describe("equipment — staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test.skip(!enabled, "Disposable CI database only");

  test("staff sees the operational record only — no money, no retire", async ({ page }) => {
    test.skip(!fs.existsSync(staff), "Authenticated staff fixture required");
    const { prisma } = await import("../src/lib/prisma");
    const tag = randomUUID().slice(0, 8);
    const asset = `CI-EQ-${tag}-staff`;
    const type = await prisma.applianceType.findFirstOrThrow();
    const id = `eq-${tag}-staff`;
    try {
      await prisma.appliance.create({
        data: {
          id,
          assetNumber: asset,
          applianceTypeId: type.id,
          status: "AVAILABLE",
          serialNumber: `SN-${tag}`,
          acquisitionCostCents: 42000,
        },
      });
      await page.goto(`/desk/inventory/${id}`);
      await expect(page.getByRole("heading", { name: new RegExp(asset) })).toBeVisible();
      await expect(page.getByText(`SN-${tag}`)).toBeVisible();
      await expect(page.getByText("Earned")).toHaveCount(0);
      await expect(page.getByText("$420")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retire…" })).toHaveCount(0);
    } finally {
      await prisma.appliance.deleteMany({ where: { id } });
    }
  });

  test("staff sees parts stock only — no prices, no selling, no edit controls", async ({ page }) => {
    test.skip(!fs.existsSync(staff), "Authenticated staff fixture required");
    const { prisma } = await import("../src/lib/prisma");
    const tag = randomUUID().slice(0, 8);
    const partName = `CI belt ${tag}`;
    const partId = `part-${tag}-staff`;
    const type = await prisma.applianceType.findFirstOrThrow();
    try {
      await prisma.partRecord.create({
        data: {
          id: partId,
          modelNumber: `CI-M-${tag}`,
          partNumber: `CI-P-${tag}`,
          partName,
          applianceTypeId: type.id,
          quantityOnHand: 1,
          reorderThreshold: 3,
          sellable: true,
          retailPriceCents: 2599,
          resaleUnitsOnHand: 1,
          resaleCostOnHandCents: 1000,
        },
      });
      await page.goto("/desk/parts?status=low");
      await expect(page.getByRole("link", { name: new RegExp(partName) })).toBeVisible();
      await expect(page.getByText("1 on hand")).toBeVisible();
      // Scoped to the list: the Low stock TAB also carries the words.
      await expect(
        page.getByRole("list", { name: "Parts" }).getByText("Low stock"),
      ).toBeVisible();
      // The staff DTO carries no money keys, so nothing money-shaped can
      // render: no price, no Selling or Reorder columns, no row menu.
      await expect(page.getByText("$25.99")).toHaveCount(0);
      await expect(page.getByText("Selling")).toHaveCount(0);
      await expect(page.getByText("Reorder at")).toHaveCount(0);
      await expect(page.getByRole("button", { name: `More for ${partName}` })).toHaveCount(0);
      await expect(page.getByText("Used some")).toHaveCount(0);
      await expect(page.getByText("Edit stock")).toHaveCount(0);
    } finally {
      await prisma.partRecord.deleteMany({ where: { id: partId } });
    }
  });
});
