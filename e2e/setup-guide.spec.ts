import fs from "node:fs";
import { test, expect } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/appliance_desk_test");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

// SETUP-1: the guide lists the walkthroughs; the EIN step saves its number
// onto the business record (masked there, never in full); a step the owner
// does by hand can be marked done and shows in the walkthrough's progress.
test("setup guide: walkthroughs, EIN step saves a masked number, manual step marks done", async ({ page }) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  try {
    await page.goto("/desk/setup-guide");
    await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
    await expect(page.getByText("Federal tax number (EIN)")).toBeVisible();

    // EIN walkthrough: type the number, save it, watch the step check itself.
    await page.goto("/desk/setup-guide/ein");
    await expect(page.getByRole("heading", { name: "Federal tax number (EIN)" })).toBeVisible();
    await page.getByLabel(/Save the EIN/).fill("12-3456789");
    await page.getByRole("button", { name: "Save number" }).click();
    await expect(page.getByText("Saved to the record.")).toBeVisible();
    await expect(page.getByText(/Checked ✓/).first()).toBeVisible();

    // The record shows only the masked number, never the full EIN.
    await page.getByRole("link", { name: /Open the record/ }).click();
    await page.waitForURL(/\/desk\/paperwork\/[a-z0-9]{10,}$/);
    await expect(page.getByText("••••6789").first()).toBeVisible();
    await expect(page.getByText("12-3456789")).toHaveCount(0);

    // A step with no automatic check: "I did this" marks it, and the list
    // page progress moves.
    await page.goto("/desk/setup-guide/business-basics");
    const tradeNameCard = page.locator("section", { hasText: "Register the trade name" });
    await tradeNameCard.getByRole("button", { name: "I did this" }).click();
    await expect(page.getByText("Done — you marked it.")).toBeVisible();
    await page.goto("/desk/setup-guide");
    await expect(page.getByText("Business basics: your LLC")).toBeVisible();
  } finally {
    // Leave the disposable database as the suite found it.
    await prisma.auditLog.deleteMany({ where: { entityType: "SetupGuide" } });
    const ein = await prisma.businessPaperwork.findUnique({ where: { templateKey: "ein" } });
    if (ein) {
      await prisma.businessRecordFile.deleteMany({ where: { recordId: ein.id } });
      await prisma.businessPaperwork.delete({ where: { id: ein.id } });
    }
    await prisma.$disconnect();
  }
});
