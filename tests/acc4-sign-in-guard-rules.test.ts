import { describe, expect, it } from "vitest";
import { nextFailureState, pauseMessage, validatePauseSettings } from "@/domains/security/sign-in-guard-rules";

describe("ACC-4 wrong-password pause rules", () => {
  const t0 = new Date("2026-10-24T12:00:00Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it("counts wrong passwords inside the window and pauses on the allowed number", () => {
    let state: { count: number; windowStartedAt: Date | null } = { count: 0, windowStartedAt: null };
    for (let i = 1; i <= 9; i++) {
      const next = nextFailureState(state, at(i * 0.1), 10, 15);
      expect(next.justPaused).toBe(false);
      expect(next.count).toBe(i);
      state = next;
    }
    const last = nextFailureState(state, at(2), 10, 15);
    expect(last.justPaused).toBe(true);
    expect(last.pausedUntil?.toISOString()).toBe(at(17).toISOString());
    expect(last.count).toBe(0);
  });

  it("starts a fresh count when the window has run out", () => {
    const next = nextFailureState({ count: 9, windowStartedAt: t0 }, at(16), 10, 15);
    expect(next.count).toBe(1);
    expect(next.justPaused).toBe(false);
    expect(next.windowStartedAt?.toISOString()).toBe(at(16).toISOString());
  });

  it("describes the wait in whole minutes", () => {
    expect(pauseMessage(at(15), t0)).toContain("15 minutes");
    expect(pauseMessage(at(0.2), t0)).toContain("1 minute.");
  });

  it("keeps the owner's numbers in a sensible range", () => {
    expect(validatePauseSettings(10, 15)).toEqual({ attempts: 10, minutes: 15 });
    for (const [a, m] of [[2, 15], [51, 15], [10, 0], [10, 241], [1.5, 15], ["x", 15]] as const) expect(() => validatePauseSettings(a, m)).toThrow();
  });
});
