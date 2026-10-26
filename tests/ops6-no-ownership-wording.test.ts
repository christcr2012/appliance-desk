import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// OPS-6 product rule: this business rents. It never offers a way to own an appliance through rental payments,
// because that would bring Colorado's rental-purchase law. This test fails if any agreement template, quote text,
// notice template or customer signing wording drifts into ownership or purchase-option language.
const FORBIDDEN = [
  /rent[- ]to[- ]own/i,
  /lease[- ]to[- ]own/i,
  /rental[- ]purchase/i,
  /purchase option/i,
  /option to (buy|purchase)/i,
  /(buy|purchase)[- ]?out\b/i,
  /you (will|may|can) (own|keep) (it|the (appliance|washer|dryer|unit))/i,
  /ownership (passes|transfers|will transfer) to (you|the customer|the renter)/i,
  /after (the )?(last|final) payment[^.]{0,40}\b(own|yours|belongs to you)/i,
  /(appliance|machine|unit) (becomes|will become) yours/i,
];

const ROOTS = [
  "src/domains/agreements",
  "src/domains/paperwork",
  "src/domains/estimates",
  "src/domains/notices",
  "src/domains/documents",
  "src/domains/collections",
  "src/domains/language",
  "src/app/(public)",
];

function files(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) return files(full);
      return /\.(ts|tsx|json|md)$/.test(name) ? [full] : [];
    });
  } catch {
    return [];
  }
}

describe("no ownership or purchase-option wording", () => {
  const targets = ROOTS.flatMap(files);
  it("looks at the agreement, quote, notice and collection wording files", () => {
    expect(targets.length).toBeGreaterThan(20);
    expect(targets.some((f) => f.includes("paperwork/templates"))).toBe(true);
    expect(targets.some((f) => f.includes("collections/templates"))).toBe(true);
  });
  it("finds none of the forbidden phrases", () => {
    const hits: string[] = [];
    for (const file of targets) {
      const text = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        const m = text.match(pattern);
        if (m) hits.push(`${file}: "${m[0]}"`);
      }
    }
    expect(hits).toEqual([]);
  });
  it("would catch the wording if it appeared", () => {
    expect(FORBIDDEN.some((p) => p.test("Own it after 12 payments with our rent-to-own plan"))).toBe(true);
    expect(FORBIDDEN.some((p) => p.test("Add a purchase option at the end"))).toBe(true);
    expect(FORBIDDEN.some((p) => p.test("Title stays with Robinson Appliance Rentals at all times."))).toBe(false);
  });
});
