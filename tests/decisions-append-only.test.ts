import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const files = [...sourceFiles("src"), ...sourceFiles("prisma").filter((path) => path.endsWith(".ts"))];

describe("Decisions & reviews guards (DEC-1a)", () => {
  it("never updates or deletes a decision record (append-only)", () => {
    const offenders = files.filter((path) =>
      /decisionRecord\.(update|updateMany|upsert|delete|deleteMany)\s*\(/.test(readFileSync(path, "utf8")) ||
      /(UPDATE|DELETE FROM)\s+"DecisionRecord"/i.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("never rewrites or deletes taxability history", () => {
    const offenders = files.filter((path) =>
      /taxabilityRuleVersion\.(update|updateMany|upsert|delete|deleteMany)\s*\(/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("reads the taxability rules table only in locations.ts, so dated reads can't be bypassed", () => {
    const offenders = files.filter((path) => path !== join("src", "domains", "tax", "locations.ts") &&
      /taxabilityRule\.findMany\s*\(/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("writes the decision settings only through their domain saves (the registry never writes a table)", () => {
    const registry = readFileSync("src/domains/decisions/registry.ts", "utf8");
    expect(registry).not.toMatch(/tx\.\w+\.(create|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(registry).not.toMatch(/\$executeRaw/);
  });
});
