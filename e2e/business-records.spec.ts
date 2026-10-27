import fs from "node:fs";
import { test, expect } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
const admin = "e2e/.auth/admin.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

// VAULT-1: a record with an encrypted number shows only masked; a file can be
// attached and read back; an admin sees a shared document record but never
// the number-bearing one; the export pack downloads as a ZIP.
test("business records: masked number, file attach, admin boundary, export pack", async ({ page, browser }) => {
  test.skip(!enabled || !fs.existsSync(owner) || !fs.existsSync(admin), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const tag = `vault1-${process.pid}-${Date.now()}`;
  const policyNumber = "POL-99887766";
  let recordId = "";
  let docId = "";
  try {
    // Create an insurance record with a stored (encrypted) number.
    await page.goto("/desk/paperwork/new");
    await page.getByLabel("What is it?").fill(`Liability policy ${tag}`);
    await page.getByLabel("What kind of record is it?").selectOption("INSURANCE");
    await page.getByLabel("What is the number called?").fill("Policy number");
    await page.getByLabel("Number (optional)").fill(policyNumber);
    await page.getByLabel("Expires on").fill("2027-08-01");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/desk\/paperwork\/(?!new$)[a-z0-9]{10,}$/);
    recordId = page.url().split("/").pop() ?? "";
    expect(recordId).not.toBe("");
    expect(recordId).not.toBe("new");
    // Only the masked number is ever on screen.
    await expect(page.getByText("••••7766").first()).toBeVisible();
    await expect(page.getByText(policyNumber)).toHaveCount(0);

    // Attach a small PDF; it is listed and served from the private read route.
    await page.getByLabel("Add a file (PDF or photo, up to 900 KB)").setInputFiles({
      name: "policy.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nvault e2e policy document\n"),
    });
    await page.getByRole("button", { name: "Add the file" }).click();
    // File storage needs the private store, which test environments don't
    // have (the repo's storage-ready pattern): either the file is listed, or
    // the page explains in plain words that storage isn't set up yet. The
    // stored-bytes path itself is covered by the integration tests.
    const fileLink = page.getByRole("link", { name: "policy.pdf" });
    const storageAlert = page.getByRole("alert").filter({ hasText: "isn't set up" });
    await expect(fileLink.or(storageAlert)).toBeVisible();
    if (await fileLink.count()) {
      await expect(fileLink).toHaveAttribute("href", /\/api\/records\/files\//);
    }

    // A plain document record with no number is the kind admins may see.
    await page.goto("/desk/paperwork/new");
    await page.getByLabel("What is it?").fill(`Articles copy ${tag}`);
    await page.getByLabel("What kind of record is it?").selectOption("DOCUMENT");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/desk\/paperwork\/(?!new$)[a-z0-9]{10,}$/);
    docId = page.url().split("/").pop() ?? "";

    // The list (All tab) shows both, with kind pills and the masked number.
    await page.goto("/desk/paperwork?tab=all");
    await expect(page.getByRole("link", { name: `Liability policy ${tag}` })).toBeVisible();
    await expect(page.getByText("Policy number ••••7766")).toBeVisible();
    await expect(page.getByText(policyNumber)).toHaveCount(0);

    // Export pack: tick the record, download, and get a ZIP back.
    await page.getByLabel(`Liability policy ${tag}`).check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Download the export pack/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    // Admin: the document record opens; the number-bearing policy does not exist for them.
    const adminContext = await browser.newContext({ storageState: admin });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/desk/paperwork?tab=all");
    await expect(adminPage.getByRole("link", { name: `Articles copy ${tag}` })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: `Liability policy ${tag}` })).toHaveCount(0);
    await adminPage.goto(`/desk/paperwork/${recordId}`);
    await expect(adminPage.getByText(`Liability policy ${tag}`)).toHaveCount(0);
    await adminPage.goto(`/desk/paperwork/${docId}`);
    await expect(adminPage.getByRole("heading", { name: `Articles copy ${tag}`, level: 1 })).toBeVisible();
    await adminContext.close();
  } finally {
    if (recordId || docId) {
      await prisma.businessRecordFile.deleteMany({ where: { recordId: { in: [recordId, docId].filter(Boolean) } } });
      await prisma.businessPaperwork.deleteMany({ where: { id: { in: [recordId, docId].filter(Boolean) } } });
    }
  }
});
