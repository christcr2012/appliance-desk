import { describe, expect, it } from "vitest";

import { SETTINGS_FIELDS } from "@/domains/settings/section-config";
import { businessSettingsSchema } from "@/domains/settings/form-schema";

describe("legacy global sales-tax controls", () => {
  it("are no longer accepted by the settings form contract", () => {
    expect("taxRatePercentText" in businessSettingsSchema.shape).toBe(false);
    expect("taxRateConfirmed" in businessSettingsSchema.shape).toBe(false);
    expect(SETTINGS_FIELDS.policies).not.toContain("taxRatePercentText");
    expect(SETTINGS_FIELDS.policies).not.toContain("taxRateConfirmed");
  });
});
