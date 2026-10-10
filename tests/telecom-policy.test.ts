import { describe, expect, it } from "vitest";
import { communicationsPolicySchema } from "@/domains/messaging/communications-policy";
import { RECOMMENDED_TELECOM_ALERT_RULES } from "@/domains/messaging/telecom-alerts";

describe("COM-L13A suggested budget policy",()=>{
  const base={
    schemaVersion:1 as const,manualSmsEnabled:false,
    primaryAccountId:"recorded-account-001",primaryNumberId:"recorded-number-001",
    approvedPolicyVersion:2,maxSegments:3,supportedCountries:["US" as const],
  };
  it("provides an inactive recommendation while preserving separate sending gates",()=>{
    const draft=communicationsPolicySchema.parse({
      ...base,telecomCostAlerts:RECOMMENDED_TELECOM_ALERT_RULES,
    });
    expect(draft.telecomCostAlerts?.enabled).toBe(false);
    expect(draft.manualSmsEnabled).toBe(false);
    expect(draft.telecomCostAlerts?.monthlyBudgetCents).toBe(5000);
    expect(draft.telecomCostAlerts?.criticalCents).toBe(10000);
  });
  it("rejects unordered thresholds and unsafe currency/cent settings",()=>{
    expect(communicationsPolicySchema.safeParse({
      ...base,telecomCostAlerts:{
        ...RECOMMENDED_TELECOM_ALERT_RULES,
        monthlyBudgetCents:10000,elevatedCents:7500,
      },
    }).success).toBe(false);
    expect(communicationsPolicySchema.safeParse({
      ...base,telecomCostAlerts:{
        ...RECOMMENDED_TELECOM_ALERT_RULES,criticalCents:0.5,
      },
    }).success).toBe(false);
  });
});
