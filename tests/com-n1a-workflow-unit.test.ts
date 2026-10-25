import { describe, expect, it } from "vitest";
import { isInQuietHours, minuteLabel, quietHoursEndAt, quietHoursSentence, RECOMMENDED_QUIET_HOURS } from "@/domains/messaging/quiet-hours";
import { REQUIRED_TEXT_FOOTER, WORKFLOW_TEXT_FAMILIES } from "@/domains/messaging/workflow-text-catalog";
import { smsPreview, templateVariables } from "@/domains/messaging/sms-template";
import { maskPhone } from "@/domains/messaging/workflow-text";

describe("quiet hours", () => {
  it("wrap midnight in Colorado time and follow daylight saving", () => {
    expect(isInQuietHours(new Date("2026-07-01T04:00:00Z"))).toBe(true); // 10 pm MDT
    expect(isInQuietHours(new Date("2026-07-01T18:00:00Z"))).toBe(false); // noon MDT
    expect(isInQuietHours(new Date("2026-12-01T04:30:00Z"))).toBe(true); // 9:30 pm MST
    expect(isInQuietHours(new Date("2026-12-01T15:30:00Z"))).toBe(false); // 8:30 am MST
    expect(isInQuietHours(new Date("2026-12-01T14:59:00Z"))).toBe(true); // 7:59 am MST
  });
  it("equal start and end means never quiet, and the end time is the next allowed minute", () => {
    expect(isInQuietHours(new Date("2026-07-01T06:00:00Z"), { startMinute: 0, endMinute: 0 })).toBe(false);
    const end = quietHoursEndAt(new Date("2026-07-01T06:00:00Z"));
    expect(end.toISOString()).toBe("2026-07-01T14:00:00.000Z");
  });
  it("labels", () => {
    expect(minuteLabel(0)).toBe("12:00 am");
    expect(quietHoursSentence(RECOMMENDED_QUIET_HOURS)).toContain("9:00 pm until 8:00 am");
  });
});

describe("workflow text catalog", () => {
  it("every starting text names the business, offers STOP and fits 3 parts at worst-case values", () => {
    for (const f of WORKFLOW_TEXT_FAMILIES) {
      expect(f.defaultBody).toMatch(/^Robinson Appliance Rentals:/);
      expect(f.defaultBody).toMatch(REQUIRED_TEXT_FOOTER);
      const names = templateVariables(f.defaultBody, f.variables);
      expect(names.length).toBeGreaterThanOrEqual(0);
      const worst = f.defaultBody.replace(/\{\{(\w+)\}\}/g, (_m, n: string) => "w".repeat(f.variables[n].maxLength));
      expect(smsPreview(worst).segments).toBeLessThanOrEqual(3);
    }
  });
  it("keys are unique", () => {
    expect(new Set(WORKFLOW_TEXT_FAMILIES.map((f) => f.key)).size).toBe(WORKFLOW_TEXT_FAMILIES.length);
  });
  it("masks phone numbers on screen", () => {
    expect(maskPhone("+13035550142")).toBe("(303) ***-0142");
  });
});
