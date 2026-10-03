import { describe, expect, it } from "vitest";
import { RECOMMENDED_TERMS_POLICY } from "@/domains/settings/recommended-terms";
import { termsPolicyStatus, termsPolicyUpdate } from "@/domains/settings/terms-policy";
import { autoRenewPolicyReady, loadTerminationPolicy } from "@/domains/agreements/term-policy";

describe("recommended starting terms", () => {
  const parsed = termsPolicyUpdate(RECOMMENDED_TERMS_POLICY);

  it("pass the same checks as anything the owner types", () => {
    expect(parsed.success).toBe(true);
  });

  it("make both early ending and automatic renewal available", () => {
    if (!parsed.success) throw new Error(parsed.message);
    const settings = parsed.update;
    expect(loadTerminationPolicy(settings)).not.toBeNull();
    expect(autoRenewPolicyReady(settings)).toBe(true);
    const status = termsPolicyStatus(settings);
    expect(status.earlyEnding.available).toBe(true);
    expect(status.autoRenew.available).toBe(true);
  });

  it("keep the renewal reminder inside Colorado's 25 to 40 day window", () => {
    const days = Number(RECOMMENDED_TERMS_POLICY.autoRenewNoticeDays);
    expect(days).toBeGreaterThanOrEqual(25);
    expect(days).toBeLessThanOrEqual(40);
  });

  it("repeat no number the owner can change inside the wording", () => {
    expect(RECOMMENDED_TERMS_POLICY.terminationTermsText).not.toMatch(/\d/);
    expect(RECOMMENDED_TERMS_POLICY.renewalTermsText).not.toMatch(/\d/);
  });
});
