import fs from "node:fs";
import { test, expect } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/appliance_desk_test");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

// VAULT-2: the vault list shows names and masked usernames only; a secret
// can't be saved or shown without an unlock; with an unlock row for this
// exact session (inserted directly — a real second-step code can't be
// produced in a test), Show reveals the value and Hide hides it again.
test("vault: masked list, unlock gate, reveal and hide", async ({ page }) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const { encryptVaultField } = await import("../src/lib/field-crypto");
  const tag = `vault2-${process.pid}-${Date.now()}`;
  const password = `E2eVault!${Date.now()}`;
  let credentialId = "";
  let ownerId = "";
  try {
    const ownerUser = await prisma.user.findFirst({ where: { role: "OWNER", archivedAt: null }, orderBy: { createdAt: "asc" } });
    ownerId = ownerUser?.id ?? "";
    expect(ownerId).not.toBe("");
    const created = await prisma.vaultCredential.create({
      data: {
        title: `Bank login ${tag}`,
        url: "https://example.test/login",
        usernameEncrypted: encryptVaultField(`vault-${tag}@example.test`),
        passwordEncrypted: encryptVaultField(password),
      },
    });
    credentialId = created.id;

    await page.goto("/desk/vault");
    await expect(page.getByRole("heading", { name: "Logins vault" })).toBeVisible();
    await expect(page.getByText("For the most sensitive logins (your bank), a password manager is safer")).toBeVisible();
    await expect(page.getByText(`Bank login ${tag}`)).toBeVisible();
    // Masked only: the full username and password are nowhere on the page.
    await expect(page.getByText(`v•••@example.test`)).toBeVisible();
    await expect(page.getByText(password)).toHaveCount(0);
    await expect(page.getByText(`vault-${tag}@example.test`)).toHaveCount(0);

    // The detail page refuses to show anything before an unlock.
    await page.goto(`/desk/vault/${credentialId}`);
    await expect(page.getByText("Saved (encrypted)").first()).toBeVisible();
    await page.getByRole("button", { name: "Show" }).first().click();
    await expect(page.getByText(/Unlock the vault with a fresh sign-in code first/)).toBeVisible();
    await expect(page.getByText(password)).toHaveCount(0);

    // Give this exact browser session an unlock row, as a verified
    // second-step code would, then Show reveals and Hide hides again.
    const sessions = await prisma.session.findMany({
      where: { userId: ownerId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      await prisma.vaultUnlock.create({
        data: { userId: ownerId, sessionId: s.id, expiresAt: new Date(Date.now() + 5 * 60_000) },
      });
    }
    await page.reload();
    await page.getByRole("button", { name: "Show" }).nth(1).click();
    await expect(page.getByText(password)).toBeVisible();
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByText(password)).toHaveCount(0);
  } finally {
    if (credentialId) await prisma.vaultCredential.deleteMany({ where: { id: credentialId } });
    if (ownerId) await prisma.vaultUnlock.deleteMany({ where: { userId: ownerId } });
    await prisma.$disconnect();
  }
});
