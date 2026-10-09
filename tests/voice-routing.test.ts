import { describe, expect, it } from "vitest";
import { decideVoiceRoute } from "@/domains/messaging/voice-routing";

const route = {
  timezone: "America/Denver", forwardTo: "+13035551233",
  destinationVerifiedAt: "2026-01-01T00:00:00Z",
  destinationApprovedAt: "2026-01-01T00:00:00Z",
  timeoutSeconds: 20,
  weeklyHours: Array.from({ length: 7 }, (_, weekday) =>
    ({ weekday, from: "08:00", to: "17:00" })),
  closedDates: [], afterHoursMode: "CLOSED",
  greeting: "Our office is closed.", unavailableGreeting: "We are unavailable.",
};
function decide(now: Date, changes: Record<string, unknown> = {}) {
  return decideVoiceRoute({
    enabled: true, policyVersion: 5, approvedVersion: 5,
    routing: route, accountReady: true, numberReady: true,
    callerNumber: "+13035551232", businessNumber: "+13035551231", now, ...changes,
  });
}
describe("COM-L8 voice hours and launch fences", () => {
  it("routes only during local Denver office hours", () => {
    expect(decide(new Date("2026-07-10T15:00:00Z")).kind).toBe("DIAL"); // 9am MDT
    expect(decide(new Date("2026-07-10T02:00:00Z")).kind).toBe("CLOSED"); // 8pm Thu MDT
    expect(decide(new Date("2026-01-09T16:00:00Z")).kind).toBe("DIAL"); // 9am MST
    expect(decide(new Date("2026-01-10T01:00:00Z")).kind).toBe("CLOSED"); // 6pm Fri MST
  });
  it("honors Denver holiday closures and handles DST gap", () => {
    expect(decide(new Date("2026-07-10T15:00:00Z"), {
      routing: { ...route, closedDates: ["2026-07-10"] },
    }).kind).toBe("CLOSED");
    expect(decide(new Date("2026-03-08T09:00:00Z")).kind).toBe("CLOSED"); // DST Sunday 3am
  });
  it("fails closed without approval, readiness or version", () => {
    expect(decide(new Date("2026-07-10T15:00:00Z"), { enabled: false }).kind).toBe("UNAVAILABLE");
    expect(decide(new Date("2026-07-10T15:00:00Z"), { numberReady: false }).kind).toBe("UNAVAILABLE");
    expect(decide(new Date("2026-07-10T15:00:00Z"), { approvedVersion: 4 }).kind).toBe("UNAVAILABLE");
    expect(decide(new Date("2026-07-10T15:00:00Z"), {
      routing: { ...route, destinationApprovedAt: "2035-01-01T00:00:00Z" },
    }).kind).toBe("UNAVAILABLE");
  });
  it("never forwards to the business number, caller, or an unverified shape", () => {
    const now = new Date("2026-07-10T15:00:00Z");
    expect(decide(now, { routing: { ...route, forwardTo: "+13035551232" } }).kind)
      .toBe("UNAVAILABLE");
    expect(decide(now, { routing: { ...route, forwardTo: "+13035551231" } }).kind)
      .toBe("UNAVAILABLE");
    expect(decide(now, { routing: { ...route, forwardTo: "555-1234" } }).kind)
      .toBe("UNAVAILABLE");
  });
});
