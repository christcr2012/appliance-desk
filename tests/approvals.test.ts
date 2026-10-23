import { describe, expect, it } from "vitest";
import { approvalRequired, parseApprovalThresholds } from "@/domains/approvals";

// Batch O-3: the pure rule. Limits start off, the owner never needs approval, and the limit is "at or above".
describe("approval rule (pure)", () => {
  const limits = { WRITE_OFF: 5_000 };
  it("never asks the owner, never asks when no limit is set, asks only at or above the limit", () => {
    expect(approvalRequired("OWNER", limits, "WRITE_OFF", 1_000_000)).toBe(false);
    expect(approvalRequired("ADMIN", {}, "WRITE_OFF", 1_000_000)).toBe(false);
    expect(approvalRequired("ADMIN", limits, "WRITE_OFF", 4_999)).toBe(false);
    expect(approvalRequired("ADMIN", limits, "WRITE_OFF", 5_000)).toBe(true);
    expect(approvalRequired("ADMIN", limits, "EXPENSE", 5_000)).toBe(false); // a limit on one kind does not cover another
  });
  it("reads only whole-cent limits of at least $0.01 for kinds that exist", () => {
    expect(parseApprovalThresholds({ WRITE_OFF: 5000, EXPENSE: 0, REFUND: 100, x: 1 })).toEqual({ WRITE_OFF: 5000 });
    expect(parseApprovalThresholds(null)).toEqual({});
    expect(parseApprovalThresholds({ WRITE_OFF: 12.5 })).toEqual({});
  });
});
