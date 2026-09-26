import { describe, it, expect } from "vitest";
import { canTransitionMaintenanceStatus } from "@/domains/maintenance";

// canTransitionMaintenanceStatus is the pure rule updateMaintenanceStatus
// (src/domains/maintenance/index.ts) enforces server-side — see
// docs/BUSINESS-RULES.md's "Maintenance status flow": submitted ->
// reviewing -> scheduled -> in_progress -> resolved -> closed, with
// closed reachable from any non-terminal status.
describe("canTransitionMaintenanceStatus", () => {
  it("follows the happy path in order", () => {
    expect(canTransitionMaintenanceStatus("SUBMITTED", "REVIEWING")).toEqual({
      ok: true,
    });
    expect(canTransitionMaintenanceStatus("REVIEWING", "SCHEDULED")).toEqual({
      ok: true,
    });
    expect(canTransitionMaintenanceStatus("SCHEDULED", "IN_PROGRESS")).toEqual({
      ok: true,
    });
    expect(canTransitionMaintenanceStatus("IN_PROGRESS", "RESOLVED")).toEqual({
      ok: true,
    });
    expect(canTransitionMaintenanceStatus("RESOLVED", "CLOSED")).toEqual({ ok: true });
  });

  it("allows closing out from any non-terminal status", () => {
    expect(canTransitionMaintenanceStatus("SUBMITTED", "CLOSED").ok).toBe(true);
    expect(canTransitionMaintenanceStatus("REVIEWING", "CLOSED").ok).toBe(true);
    expect(canTransitionMaintenanceStatus("SCHEDULED", "CLOSED").ok).toBe(true);
    expect(canTransitionMaintenanceStatus("IN_PROGRESS", "CLOSED").ok).toBe(true);
  });

  it("rejects moving to the same status", () => {
    expect(canTransitionMaintenanceStatus("SUBMITTED", "SUBMITTED").ok).toBe(false);
  });

  it("rejects any transition out of closed — it's terminal", () => {
    expect(canTransitionMaintenanceStatus("CLOSED", "SUBMITTED").ok).toBe(false);
  });

  it("rejects skipping steps out of order", () => {
    expect(canTransitionMaintenanceStatus("SUBMITTED", "SCHEDULED").ok).toBe(false);
    expect(canTransitionMaintenanceStatus("SUBMITTED", "IN_PROGRESS").ok).toBe(false);
  });
});
