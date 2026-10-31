import { describe, expect, it } from "vitest";
import {
  REPAIR_PILL,
  VISIT_PILL,
  repairPriorityChip,
  visitPill,
  visitTitle,
  visitWhen,
} from "@/domains/jobs/words";
import { maintenancePriorityLabel } from "@/lib/status-labels";

// 2026-10-30 16:00 UTC is 10:00 AM in Denver (MDT, UTC-6) on the same calendar day.
const NOW = new Date("2026-10-30T16:00:00Z");
const TODAY_9AM_DENVER = new Date("2026-10-30T15:00:00Z");
const TOMORROW_9AM_DENVER = new Date("2026-10-31T15:00:00Z");

describe("visitTitle", () => {
  it("joins the plain-word type label and the customer name", () => {
    expect(
      visitTitle({ type: "DELIVERY", scheduledAt: null, customer: { user: { name: "Ana Ruiz" } } }),
    ).toBe("Delivery · Ana Ruiz");
  });

  it("falls back to 'No customer' when there is no customer name", () => {
    expect(visitTitle({ type: "REMOVAL", scheduledAt: null, customer: null })).toBe(
      "Pickup / removal · No customer",
    );
    expect(visitTitle({ type: "MAINTENANCE_VISIT", scheduledAt: null, customer: { user: null } })).toBe(
      "Maintenance visit · No customer",
    );
  });
});

describe("visitWhen", () => {
  it("says 'No time yet' without a scheduled time", () => {
    expect(visitWhen({ scheduledAt: null }, NOW)).toBe("No time yet");
  });

  it("uses the relative Denver day and the Denver clock time", () => {
    expect(visitWhen({ scheduledAt: TODAY_9AM_DENVER }, NOW)).toBe("today at 9:00 AM MDT");
    expect(visitWhen({ scheduledAt: TOMORROW_9AM_DENVER }, NOW)).toBe("tomorrow at 9:00 AM MDT");
  });
});

describe("VISIT_PILL and visitPill", () => {
  it("covers every job status with the spec's words and tones", () => {
    expect(VISIT_PILL).toEqual({
      SCHEDULED: { label: "Booked", tone: "info" },
      IN_PROGRESS: { label: "Under way", tone: "attention" },
      COMPLETED: { label: "Done", tone: "good" },
      CANCELLED: { label: "Cancelled", tone: "neutral" },
    });
  });

  it("a no-show reads 'Nobody home' instead of the status pill", () => {
    expect(visitPill({ status: "CANCELLED", noShowAt: NOW })).toEqual({
      label: "Nobody home",
      tone: "attention",
    });
    expect(visitPill({ status: "SCHEDULED", noShowAt: null })).toEqual(VISIT_PILL.SCHEDULED);
  });
});

describe("REPAIR_PILL and the priority chip", () => {
  it("covers every maintenance status with the spec's words and tones", () => {
    expect(REPAIR_PILL).toEqual({
      SUBMITTED: { label: "New", tone: "attention" },
      REVIEWING: { label: "Looking at it", tone: "info" },
      SCHEDULED: { label: "Visit booked", tone: "info" },
      IN_PROGRESS: { label: "Being fixed", tone: "attention" },
      RESOLVED: { label: "Fixed", tone: "good" },
      CLOSED: { label: "Closed", tone: "neutral" },
    });
  });

  it("only URGENT and HIGH get a chip", () => {
    expect(repairPriorityChip("URGENT")).toEqual({ label: "Urgent", tone: "danger" });
    expect(repairPriorityChip("HIGH")).toEqual({ label: "High", tone: "attention" });
    expect(repairPriorityChip("NORMAL")).toBeNull();
    expect(repairPriorityChip("LOW")).toBeNull();
  });
});

describe("maintenancePriorityLabel", () => {
  it("labels every priority in plain words, English and Spanish", () => {
    expect(maintenancePriorityLabel("LOW")).toBe("Low");
    expect(maintenancePriorityLabel("NORMAL")).toBe("Normal");
    expect(maintenancePriorityLabel("HIGH")).toBe("High");
    expect(maintenancePriorityLabel("URGENT")).toBe("Urgent");
    expect(maintenancePriorityLabel("LOW", "es")).toBe("Baja");
    expect(maintenancePriorityLabel("NORMAL", "es")).toBe("Normal");
    expect(maintenancePriorityLabel("HIGH", "es")).toBe("Alta");
    expect(maintenancePriorityLabel("URGENT", "es")).toBe("Urgente");
  });
});
