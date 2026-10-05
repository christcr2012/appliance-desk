import { describe, expect, it } from "vitest";
import { automationSlot } from "@/domains/automation/runs";

describe("automationSlot", () => {
  it("uses the Colorado business date instead of the UTC date", () => {
    expect(automationSlot(new Date("2026-10-05T05:30:00.000Z"))).toBe("2026-10-04");
    expect(automationSlot(new Date("2026-10-05T06:30:00.000Z"))).toBe("2026-10-05");
  });

  it("stays calendar-correct across daylight-saving transitions", () => {
    expect(automationSlot(new Date("2026-03-08T06:59:59.000Z"))).toBe("2026-03-07");
    expect(automationSlot(new Date("2026-03-08T07:00:00.000Z"))).toBe("2026-03-08");
  });
});
