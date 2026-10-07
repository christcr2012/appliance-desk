import { describe, expect, it } from "vitest";
import {
  enforceRegressionGuard,
  perfBaselineMs,
} from "./fixtures";

describe("Batch F performance regression guard", () => {
  it("reads the committed capacity baselines", () => {
    expect(perfBaselineMs("f-large-account-owner-read")).toBeGreaterThan(0);
    expect(perfBaselineMs("f-large-invoices-billing-page")).toBeGreaterThan(0);
  });

  it("allows up to 20% and rejects anything slower without an explicit reason", () => {
    expect(enforceRegressionGuard("example", 120, 100, undefined)).toEqual({
      limitMs: 120,
      overridden: false,
    });
    expect(() => enforceRegressionGuard("example", 120.01, 100, undefined)).toThrow(/regressed/i);
  });

  it("allows a reviewed override only when a nonblank reason is supplied", () => {
    expect(enforceRegressionGuard("example", 121, 100, "known runner change")).toEqual({
      limitMs: 120,
      overridden: true,
    });
    expect(() => enforceRegressionGuard("example", 121, 100, "   ")).toThrow(/regressed/i);
  });
});
