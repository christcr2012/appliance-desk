import { describe, it, expect } from "vitest";
import { canTransitionJobStatus } from "@/domains/jobs";

// canTransitionJobStatus is the pure rule updateJobStatus
// (src/domains/jobs/index.ts) enforces server-side — see
// docs/BUSINESS-RULES.md's job/status flow. Pure and exported
// specifically so it's unit-testable despite the rest of that file
// needing a real database.
describe("canTransitionJobStatus", () => {
  it("allows starting a scheduled job", () => {
    expect(canTransitionJobStatus("SCHEDULED", "IN_PROGRESS")).toEqual({ ok: true });
  });

  it("allows completing an in-progress job", () => {
    expect(canTransitionJobStatus("IN_PROGRESS", "COMPLETED")).toEqual({ ok: true });
  });

  it("allows cancelling from scheduled or in-progress", () => {
    expect(canTransitionJobStatus("SCHEDULED", "CANCELLED").ok).toBe(true);
    expect(canTransitionJobStatus("IN_PROGRESS", "CANCELLED").ok).toBe(true);
  });

  it("rejects moving to the same status", () => {
    expect(canTransitionJobStatus("SCHEDULED", "SCHEDULED").ok).toBe(false);
  });

  it("rejects any transition out of completed or cancelled — both are terminal", () => {
    expect(canTransitionJobStatus("COMPLETED", "SCHEDULED").ok).toBe(false);
    expect(canTransitionJobStatus("CANCELLED", "SCHEDULED").ok).toBe(false);
  });

  it("rejects skipping straight from scheduled to completed", () => {
    expect(canTransitionJobStatus("SCHEDULED", "COMPLETED").ok).toBe(false);
  });
});
