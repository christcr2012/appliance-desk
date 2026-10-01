import { describe, expect, it } from "vitest";
import { settingsSectionUpdate } from "@/domains/settings/sections";
import {
  SETTINGS_FIELDS,
  settingsSection,
} from "@/domains/settings/section-config";
import { providerStatus } from "@/domains/settings/provider-status";
const profile = {
  publicBusinessName: "Robinson Rentals",
  publicPhone: "9705550100",
  publicEmail: "support@example.test",
  publicAddress: "Approved business address",
};
describe("isolated settings writes", () => {
  it("profile updates exclude stale prices, policies, staff and injected fields", () => {
    expect(
      settingsSectionUpdate("profile", {
        ...profile,
        deliveryFeeDollars: 999,
        taxRateConfirmed: true,
        referralRewardDollars: 999,
        role: "OWNER",
      }),
    ).toEqual({ success: true, update: profile });
  });
  it("service area saves preserve profile and money settings, including intentional empty lists", () => {
    expect(
      settingsSectionUpdate("service-area", {
        serviceAreaCities: " Greeley, Evans, ",
        serviceAreaZips: "",
        publicBusinessName: "stale",
        deliveryFeeDollars: 999,
      }),
    ).toEqual({
      success: true,
      update: { serviceAreaCities: ["Greeley", "Evans"], serviceAreaZips: [] },
    });
  });
  it("converts policy dollars once and preserves explicit false/zero values", () => {
    const values = Object.fromEntries(
      SETTINGS_FIELDS.policies.map((k) => [
        k,
        k.endsWith("Enabled") || k === "taxRateConfirmed"
          ? false
          : k === "draftReservationHoldDays"
            ? 5
            : 0,
      ]),
    );
    values.deliveryFeeDollars = 45.55;
    const result = settingsSectionUpdate("policies", { ...values, ...profile });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.update).toMatchObject({
        oneTimeDeliveryFeeCents: 4555,
        taxRateConfirmed: false,
        depositEnabled: false,
        lateFeeFlatCents: 0,
      });
      expect(result.update).not.toHaveProperty("publicBusinessName");
      expect(result.update).not.toHaveProperty("deliveryFeeDollars");
    }
  });
  it("rejects invalid/missing fields and accidental string booleans", () => {
    expect(
      settingsSectionUpdate("profile", { ...profile, publicEmail: "invalid" })
        .success,
    ).toBe(false);
    expect(
      settingsSectionUpdate("profile", { publicBusinessName: "Only one field" })
        .success,
    ).toBe(false);
    const values = Object.fromEntries(
      SETTINGS_FIELDS.policies.map((k) => [
        k,
        k.endsWith("Enabled") || k === "taxRateConfirmed"
          ? false
          : k === "draftReservationHoldDays"
            ? 5
            : 0,
      ]),
    );
    expect(
      settingsSectionUpdate("policies", {
        ...values,
        taxRateConfirmed: "false",
      }).success,
    ).toBe(false);
    expect(settingsSectionUpdate("integrations", {}).success).toBe(false);
    expect(settingsSectionUpdate("__proto__", {}).success).toBe(false);
    expect(settingsSection("bad")).toBe("profile");
  });
});
describe("truthful provider states", () => {
  it("does not treat configuration as successful delivery and never returns credentials", () => {
    const secret = "private-provider-key";
    const statuses = providerStatus({
      RESEND_API_KEY: secret,
      STRIPE_SECRET_KEY: "sk_test_secret",
      STRIPE_WEBHOOK_SECRET: secret,
      TWILIO_AUTH_TOKEN: secret,
    });
    expect(statuses.find((s) => s.name === "Email")?.state).toMatch(
      /requires verification/,
    );
    expect(statuses.find((s) => s.name === "SMS")?.state).toMatch(
      /Not fully configured/,
    );
    expect(statuses.find((s) => s.name === "Payments")?.state).toBe(
      "Test key configured",
    );
    expect(JSON.stringify(statuses)).not.toContain(secret);
  });
  it("distinguishes suppressed preview email, rejected live keys and disabled preview storage", () => {
    const states = providerStatus({
      VERCEL_ENV: "preview",
      RESEND_API_KEY: "configured",
      STRIPE_SECRET_KEY: "sk_live_secret",
      BLOB_READ_WRITE_TOKEN: "configured",
    });
    expect(states[0].state).toContain("suppressed");
    expect(states[2].state).toContain("test key is required");
    expect(states[4].state).toContain("disabled");
  });
});
