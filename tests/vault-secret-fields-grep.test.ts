import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * VAULT-2, spec §5: the four encrypted-secret column names may appear ONLY
 * in the vault and paperwork domains (plus their tests). Anywhere else — a
 * screen, an export, a notification, an ops path — would mean a second code
 * path can read a stored secret, which the vault's owner-only, unlock-gated,
 * one-field-at-a-time rule forbids. This test fails the build if a new
 * mention appears outside the allowed directories.
 */
const SECRET_FIELDS = ["passwordEncrypted", "usernameEncrypted", "notesEncrypted", "numberEncrypted"];
const ALLOWED_PREFIXES = ["src/domains/vault/", "src/domains/paperwork/"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(item.name) ? [path] : [];
  });
}

describe("vault secret field names stay inside the vault and paperwork domains", () => {
  it("finds the names only under src/domains/vault and src/domains/paperwork", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(join(process.cwd(), "src"))) {
      const rel = relative(process.cwd(), path);
      if (ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
      const content = readFileSync(path, "utf8");
      for (const field of SECRET_FIELDS) {
        if (content.includes(field)) offenders.push(`${rel} mentions ${field}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allowed domains really do use the names (the scan is not vacuous)", () => {
    const vaultIndex = readFileSync(join(process.cwd(), "src/domains/vault/index.ts"), "utf8");
    const paperworkRecords = readFileSync(join(process.cwd(), "src/domains/paperwork/records.ts"), "utf8");
    expect(vaultIndex).toContain("passwordEncrypted");
    expect(paperworkRecords).toContain("numberEncrypted");
  });
});
