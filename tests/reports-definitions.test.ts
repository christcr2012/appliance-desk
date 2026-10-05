import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { METRICS, costOrUnknown, type MetricKey } from "@/domains/reports/definitions";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("report metric definitions", () => {
  const all = Object.values(METRICS);

  it("every number has a label, date basis, calculation, type, sources and a link to its records", () => {
    for (const m of all) {
      expect(m.label.length, m.key).toBeGreaterThan(3);
      expect(m.dateBasis.length, m.key).toBeGreaterThan(5);
      expect(m.calculation.length, m.key).toBeGreaterThan(15);
      expect(["ACTUAL", "ESTIMATE"], m.key).toContain(m.kind);
      expect(m.sources.length, m.key).toBeGreaterThan(0);
      expect(m.drillHref({}), m.key).toMatch(/^\/desk\//);
    }
  });

  it("keys match their names and labels are not repeated", () => {
    for (const [key, m] of Object.entries(METRICS)) expect(m.key).toBe(key);
    const labels = all.map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("anything worked out rather than recorded says so, and nothing claims to be profit", () => {
    for (const key of ["reports.estimatedEarnings", "revenue.mrr", "revenue.arr", "fleet.rentalValue", "fleet.contribution"] as MetricKey[]) {
      expect(METRICS[key].kind, key).toBe("ESTIMATE");
    }
    expect(METRICS["fleet.contribution"].calculation).toMatch(/not profit/);
  });

  it("deposits are never described as rent or income", () => {
    expect(METRICS["revenue.cashMonth"].calculation).toMatch(/not rent/);
  });

  it("cost that was never entered shows as unknown, never zero", () => {
    const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(costOrUnknown(null, fmt)).toBe("unknown");
    expect(costOrUnknown(undefined, fmt)).toBe("unknown");
    expect(costOrUnknown(0, fmt)).toBe("$0.00");
    expect(costOrUnknown(1250, fmt)).toBe("$12.50");
  });

  it("every number on the four screens takes its label from the definitions", () => {
    const used = new Set<string>();
    for (const page of ["reports", "revenue", "fleet", "growth"]) {
      const text = readFileSync(`src/app/desk/${page}/page.tsx`, "utf8");
      for (const match of text.matchAll(/metric="([\w.]+)"/g)) used.add(match[1]);
    }
    for (const key of used) expect(Object.keys(METRICS), key).toContain(key);
    // The headline numbers of each screen are all covered.
    for (const key of ["reports.collected", "revenue.mrr", "revenue.cashMonth", "fleet.contribution", "growth.churnRisk"]) {
      expect([...used], key).toContain(key);
    }
  });
});

describe("no screen uses the word ROI", () => {
  it("fails if any file under src/app contains it", () => {
    const hits = walk("src/app").filter((file) => /\bROI\b/i.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });
});
