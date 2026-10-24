import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-WA2 guard: the app never files a return, never pays tax, and never keeps a tax-site or bank login.
 * These checks read the project files themselves, so adding such a field or call fails the build.
 */
const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));
const SECRET_FIELD = /^\s*(\w*(password|passcode|passphrase|login|username|credential|secret|apikey)\w*)\s/im;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("D-WA2: no tax-site or bank login is stored, and nothing files or pays tax by itself", () => {
  it("no tax or filing table has a field for a password, login, username, credential or secret", () => {
    const taxModels = models.filter((m) => /^(Tax|Suts|Filing|SalesTax|UseTax|PurchaseUseTax|RetailDelivery)/.test(m.name));
    expect(taxModels.length).toBeGreaterThan(5);
    const offenders = taxModels.flatMap((m) =>
      m.body.split("\n").filter((line) => !line.trim().startsWith("//") && SECRET_FIELD.test(line)).map((line) => `${m.name}: ${line.trim()}`));
    expect(offenders).toEqual([]);
  });

  it("no code sends anything to Colorado's tax sites (they are only linked to, for the owner to open)", () => {
    const calls = sourceFiles(join(root, "src")).filter((file) => {
      const text = readFileSync(file, "utf8");
      return /(fetch|axios\.\w+|got|request)\s*\(\s*[`'"][^`'"]*(revenueonline|tax\.colorado\.gov\/(suts|file)|suts)/i.test(text) ||
        /(fetch|axios\.\w+)\s*\(\s*(REVENUE_ONLINE_URL|SUTS_URL)/.test(text);
    });
    expect(calls).toEqual([]);
  });

  it("the file-and-pay screens only link out", () => {
    const text = readFileSync(join(root, "src/domains/tax/use-tax-file-now.ts"), "utf8") + readFileSync(join(root, "src/domains/tax/file-and-pay.ts"), "utf8");
    expect(text).not.toMatch(/\bfetch\s*\(/);
    expect(text).not.toMatch(/method:\s*["']POST["']/);
  });
});
