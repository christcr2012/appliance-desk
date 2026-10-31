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
 * record carries no money or retire controls. (Staff seeing Parts without
 * prices rides AR-6b, which builds the Parts page.)
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
      await expect(page.getByText("Retired", { exact: true }).first()).toBeVisible();
      const row = await prisma.appliance.findUniqueOrThrow({ where: { id: ids[0] } });
      expect(row.status).toBe("RETIRED");
    } finally {
      await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
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
      await expect(page.getByText(asset)).toBeVisible();
      await expect(page.getByText(`SN-${tag}`)).toBeVisible();
      await expect(page.getByText("Earned")).toHaveCount(0);
      await expect(page.getByText("$420")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Retire…" })).toHaveCount(0);
    } finally {
      await prisma.appliance.deleteMany({ where: { id } });
    }
  });
});
