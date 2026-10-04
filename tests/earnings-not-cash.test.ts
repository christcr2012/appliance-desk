import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Batch C P2-F: appliance and fleet screens show an ESTIMATE (a rental line's price split evenly across its
// appliances), never customer cash. Customer cash (`collectedBetween`) must not leak into them.
const root = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("appliance earnings are an estimate, not cash", () => {
  const applianceModules = [
    ...files(join(root, "src/domains/inventory")),
    ...files(join(root, "src/app/desk/fleet")),
    ...files(join(root, "src/app/desk/inventory")),
    join(root, "src/components/desk/appliance-earnings-summary.tsx"),
  ];

  it("no appliance or fleet module imports customer cash", () => {
    const offenders = applianceModules.filter((file) => {
      const text = readFileSync(file, "utf8");
      return text.includes("collectedBetween") || /from\s+["']@\/domains\/billing\/collected["']/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("the screens label the number as an estimate that splits the line price evenly", () => {
    for (const file of [join(root, "src/components/desk/appliance-earnings-summary.tsx"), join(root, "src/app/desk/fleet/page.tsx")]) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("Estimated rent (line price split evenly)");
      expect(text).not.toContain("Estimated rental value");
    }
  });
});
