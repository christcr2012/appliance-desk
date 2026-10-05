import { describe, expect, it } from "vitest";
import { AUTOMATION_RULES } from "@/domains/automation/health";

describe("automation rule registry", () => {
  it("tracks the real post-D billing reconciliation passes", () => {
    const keys = AUTOMATION_RULES.map((rule) => rule.ruleKey);
    expect(keys.filter((key) => key.startsWith("billing-reconcile:"))).toEqual([
      "billing-reconcile:provider-ops",
      "billing-reconcile:job-handoffs",
      "billing-reconcile:invoice-artifacts",
      "billing-reconcile:message-deliveries",
    ]);
    expect(keys).not.toContain("billing-reconcile:subscription-ends");
  });

  it("tracks every current renewal lifecycle pass once", () => {
    const keys = AUTOMATION_RULES.map((rule) => rule.ruleKey);
    expect(keys.filter((key) => key.startsWith("start-renewals:"))).toEqual([
      "start-renewals:auto-renewals",
      "start-renewals:annual-reminders",
      "start-renewals:pending-notices",
      "start-renewals:billing-extensions",
      "start-renewals:due-terminations",
      "start-renewals:close-returns",
      "start-renewals:start-due-renewals",
    ]);
  });

  it("has one unique key and a plain explanation for every displayed rule", () => {
    const keys = AUTOMATION_RULES.map((rule) => rule.ruleKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const rule of AUTOMATION_RULES) {
      expect(rule.label.trim().length).toBeGreaterThan(0);
      expect(rule.explanation.trim().length).toBeGreaterThan(20);
      expect(rule.resolutionHref).toContain("/desk/automations#");
    }
  });
});
