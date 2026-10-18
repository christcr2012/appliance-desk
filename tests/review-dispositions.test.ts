// F2-D (WU-F7): every old review finding has exactly one recorded disposition with evidence, and nothing is left "Pending".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const STATUSES = ["fixed", "already-fixed", "superseded", "open"];
const table = readFileSync("docs/reviews/2026-10-01-review-reconciliation.md", "utf8");
const rows = [...table.matchAll(/^\| \[#(\d+)\]\([^)]*discussion_r(\d+)\) \| (.*?) \| (.*) \|$/gm)].map((m) => ({ id: `pr${m[1]}-r${m[2]}`, text: m[4] }));
const records = JSON.parse(readFileSync("docs/reviews/dispositions/reconciliation-2026-10-01.json", "utf8")) as Array<{ findingId: string; status: string; evidence: string; pr: number }>;

describe("review dispositions", () => {
  it("covers every reconciliation row exactly once", () => {
    expect(rows).toHaveLength(91);
    expect(records.map((r) => r.findingId).sort()).toEqual(rows.map((r) => r.id).sort());
    expect(new Set(records.map((r) => r.findingId)).size).toBe(records.length);
  });
  it("gives each record a valid status, a real evidence sentence and a PR number", () => {
    for (const r of records) {
      expect(STATUSES).toContain(r.status);
      expect(r.evidence.trim().length).toBeGreaterThan(20);
      expect(Number.isInteger(r.pr) && r.pr > 0).toBe(true);
    }
  });
  it("leaves no Pending row, and an open record is shown as OPEN in the table", () => {
    expect(rows.filter((r) => /^Pending\b/.test(r.text))).toEqual([]);
    for (const r of records.filter((x) => x.status === "open")) {
      expect(rows.find((row) => row.id === r.findingId)?.text.startsWith("OPEN")).toBe(true);
    }
  });
  it("names an openable file, test or doc in every fixed or already-fixed record", () => {
    for (const r of records.filter((x) => x.status === "already-fixed" || x.status === "fixed")) {
      // either a path-like mention or a merged PR / CI reference carried over from the original table
      expect(/(\.(ts|tsx|md|json|mjs|csv|sql|txt|png)\b|src\/|docs\/|tests\/|e2e\/|prisma\/|#\d+|CI \d+)/.test(r.evidence)).toBe(true);
    }
  });
});
