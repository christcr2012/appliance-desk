import { describe, expect, it } from "vitest";
import { summarizeCheckpoint } from "../scripts/work-checkpoint.mjs";

const fixture = (changes: string[], overrides = {}) => ({
  branch: "ai/w22fin", head: "a".repeat(40),
  originMain: "b".repeat(40), commitsAhead: 0, behind: 0,
  conflicts: 0, paths: changes, ...overrides,
});

describe("work checkpoint anti-stall diagnostics", () => {
  it("warns about wide uncommitted integration, not about PR completion", () => {
    const summary = summarizeCheckpoint(fixture(
      Array.from({ length: 11 }, (_, i) => " M src/file-" + i)));
    expect(summary.changedPathCount).toBe(11);
    expect(summary.unstagedPathCount).toBe(11);
    expect(summary.commitsAheadOfOriginMain).toBe(0);
    expect(summary.warnings.some(v => v.includes("Broad uncommitted"))).toBe(true);
    expect(summary.evidenceScope).toContain("No CI");
  });
  it("identifies actual conflicts and fetched-ref drift", () => {
    const summary = summarizeCheckpoint(fixture(["UU file.ts"], {
      conflicts: 2, behind: 4,
    }));
    expect(summary.warnings.join(" ")).toContain("behind origin/main");
    expect(summary.warnings.join(" ")).toContain("Unresolved merge conflicts");
  });
  it("preserves safe read-only interpretation of an empty main checkout", () => {
    const summary = summarizeCheckpoint(fixture([], {
      branch: "main", head: "a".repeat(40), originMain: "",
    }));
    expect(summary.changedPathCount).toBe(0);
    expect(summary.warnings.join(" ")).toContain("No fetched origin/main");
    expect(summary.warnings.join(" ")).not.toContain("dirty on main");
  });
});
