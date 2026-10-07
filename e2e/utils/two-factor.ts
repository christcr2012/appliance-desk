import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

function decodeBase32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Authenticator secret contains an invalid Base32 character.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function currentTotpCode(secret: string, now = Date.now()): string {
  const counter = BigInt(Math.floor(now / 30_000));
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(input).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function completeTwoFactorSetup(
  page: Page,
  password: string,
): Promise<{ secret: string; backupCodes: string[] }> {
  // A server redirect may update the URL before the redirected RSC stream has
  // fully settled. Loading the setup URL explicitly makes both global setup
  // and the focused 2FA spec deterministic.
  await page.goto("/desk/security/setup");
  await page.getByLabel("Current password").waitFor();
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("button", { name: "Start setup" }).click();
  const secretLocator = page.getByTestId("two-factor-secret");
  await secretLocator.waitFor();
  const secret = (await secretLocator.textContent())?.trim() ?? "";
  if (!secret) throw new Error("Two-factor setup did not expose an authenticator secret.");

  await page.getByLabel("6-digit code").fill(currentTotpCode(secret));
  await page.getByRole("button", { name: "Verify and turn on" }).click();
  await page.getByText("Two-step login is on.", { exact: false }).waitFor();

  const backupCodes = (
    await page.getByTestId("two-factor-backup-codes").locator("li").allTextContents()
  ).map((code) => code.trim());
  if (backupCodes.length !== 10) {
    throw new Error(`Expected 10 backup codes, received ${backupCodes.length}.`);
  }
  await page.getByRole("button", { name: "I saved my backup codes" }).click();
  await page.waitForURL(/\/desk\/today$/);
  return { secret, backupCodes };
}
