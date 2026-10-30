import { describe, expect, it } from "vitest";
import { relativeTime } from "@/components/kit/notification-bell";

// AR-13: the bell row's relative time words (NOTIFICATIONS.md section 6).
const NOW = new Date("2026-10-29T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("relativeTime", () => {
  it("says just now under a minute", () => {
    expect(relativeTime(ago(30_000), NOW)).toBe("just now");
  });
  it("counts minutes under an hour", () => {
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5 min ago");
    expect(relativeTime(ago(59 * 60_000), NOW)).toBe("59 min ago");
  });
  it("counts hours under a day", () => {
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("3 hr ago");
    expect(relativeTime(ago(23 * 3_600_000), NOW)).toBe("23 hr ago");
  });
  it("falls back to the short date at a day or more", () => {
    expect(relativeTime(ago(30 * 3_600_000), NOW)).toMatch(/Oct 28/);
  });
});
