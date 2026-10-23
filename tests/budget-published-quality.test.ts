import { describe, expect, it } from "vitest";
import { assertPublishedQuality } from "@/domains/budget/report-math";

describe("monthly plan amount quality (Chris, 2026-10-22)", () => {
  it("keeps an unchanged estimate an estimate; hand-marking it exact is refused", () => {
    expect(() => assertPublishedQuality("ESTIMATE", false, "EXACT")).toThrow(/stays an estimate/);
    expect(() => assertPublishedQuality("OWNER_REVIEWED", false, "EXACT")).toThrow(/stays an estimate/);
    expect(() => assertPublishedQuality("ESTIMATE", false, "ESTIMATE")).not.toThrow();
    expect(() => assertPublishedQuality("ESTIMATE", false, "OWNER_REVIEWED")).not.toThrow();
  });
  it("lets the owner replace an estimate with their own reviewed estimate only", () => {
    expect(() => assertPublishedQuality("ESTIMATE", true, "OWNER_REVIEWED")).not.toThrow();
    expect(() => assertPublishedQuality("ESTIMATE", true, "EXACT")).toThrow(/Owner reviewed quality/);
    expect(() => assertPublishedQuality("EXACT", true, "ESTIMATE")).toThrow(/Owner reviewed quality/);
  });
  it("leaves exact source rows exact when unchanged", () => {
    expect(() => assertPublishedQuality("EXACT", false, "EXACT")).not.toThrow();
  });
});
