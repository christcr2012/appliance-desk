import { describe, expect, it } from "vitest";
import {
  hoursLines,
  profileExtrasDefaults,
  profileExtrasUpdate,
  safeLogoUrl,
  socialLinkList,
  upcomingClosures,
} from "@/domains/settings/profile-extras";

const none = { mode: "none", open: "09:00", close: "17:00" };
const form = (over: Record<string, unknown> = {}) => ({
  hours: { mon: none, tue: none, wed: none, thu: none, fri: none, sat: none, sun: none },
  holidayClosuresText: "",
  facebookUrl: "",
  instagramUrl: "",
  googleUrl: "",
  nextdoorUrl: "",
  logoUrl: "",
  ...over,
});
const open = (o: string, c: string) => ({ mode: "open", open: o, close: c });
const days = (d: Record<string, unknown>) => ({ ...form().hours, ...d });

describe("opening hours", () => {
  it("accepts open, closed and not-shown days", () => {
    const r = profileExtrasUpdate(form({ hours: days({ mon: open("09:00", "17:00"), sat: { ...none, mode: "closed" } }) }));
    expect(r).toMatchObject({ success: true, update: { hours: { mon: { open: "09:00", close: "17:00" }, sat: { closed: true } } } });
  });
  it("rejects bad times, reversed times and equal times", () => {
    for (const bad of [open("9am", "5pm"), open("17:00", "09:00"), open("09:00", "09:00"), open("24:00", "25:00"), open("", "")]) {
      expect(profileExtrasUpdate(form({ hours: days({ mon: bad }) })).success).toBe(false);
    }
  });
  it("rejects an unknown mode", () => {
    expect(profileExtrasUpdate(form({ hours: days({ mon: { mode: "maybe" } }) })).success).toBe(false);
  });
  it("starts with nothing shown and round-trips what was saved", () => {
    expect(hoursLines({})).toEqual([]);
    const saved = {
      mon: { open: "09:00", close: "17:00" },
      tue: { open: "09:00", close: "17:00" },
      wed: { open: "09:00", close: "17:00" },
      sat: { open: "10:00", close: "14:30" },
      sun: { closed: true },
    };
    expect(hoursLines(saved)).toEqual(["Mon–Wed: 9 am – 5 pm", "Sat: 10 am – 2:30 pm", "Sun: Closed"]);
    const d = profileExtrasDefaults({ hours: saved });
    expect(d.hours.mon).toEqual({ mode: "open", open: "09:00", close: "17:00" });
    expect(d.hours.thu.mode).toBe("none");
    expect(d.hours.sun.mode).toBe("closed");
  });
  it("ignores damaged stored hours instead of crashing", () => {
    expect(hoursLines({ mon: { open: "bad", close: "17:00" }, tue: 5, wed: null })).toEqual([]);
    expect(hoursLines("nonsense")).toEqual([]);
  });
});

describe("holiday closures", () => {
  it("parses lines, sorts by date and strips < >", () => {
    const r = profileExtrasUpdate(form({ holidayClosuresText: "2026-12-25 Christmas <b>Day\n\n2026-07-04 Fourth of July" }));
    expect(r).toMatchObject({
      success: true,
      update: {
        holidayClosures: [
          { date: "2026-07-04", label: "Fourth of July" },
          { date: "2026-12-25", label: "Christmas bDay" },
        ],
      },
    });
  });
  it("rejects a bad date, a missing name, a repeat and more than 30", () => {
    for (const text of ["2026-13-01 Nope", "2026-02-30 Nope", "2026-12-25", "12/25/2026 Christmas", "2026-12-25 A\n2026-12-25 B"]) {
      expect(profileExtrasUpdate(form({ holidayClosuresText: text })).success, text).toBe(false);
    }
    const many = Array.from({ length: 31 }, (_, i) => `2027-01-${String(i + 1).padStart(2, "0")} Day ${i}`).join("\n");
    expect(profileExtrasUpdate(form({ holidayClosuresText: many })).success).toBe(false);
    const thirty = many.split("\n").slice(0, 30).join("\n");
    expect(profileExtrasUpdate(form({ holidayClosuresText: thirty })).success).toBe(true);
  });
  it("shows only closures that have not passed, by the Colorado date", () => {
    const stored = [
      { date: "2026-10-04", label: "Yesterday" },
      { date: "2026-10-05", label: "Today" },
      { date: "2026-12-25", label: "Christmas Day" },
    ];
    // 2026-10-05 03:00 UTC is still Oct 4 in Colorado.
    expect(upcomingClosures(stored, new Date("2026-10-05T03:00:00Z")).map((c) => c.date)).toEqual([
      "2026-10-04",
      "2026-10-05",
      "2026-12-25",
    ]);
    expect(upcomingClosures(stored, new Date("2026-10-05T18:00:00Z"))).toEqual([
      { date: "2026-10-05", text: "Oct 5, 2026 — Today" },
      { date: "2026-12-25", text: "Dec 25, 2026 — Christmas Day" },
    ]);
  });
});

describe("social links and logo", () => {
  it("accepts https links only, and omits empty ones", () => {
    const ok = profileExtrasUpdate(form({ instagramUrl: "https://instagram.com/robinson", nextdoorUrl: "" }));
    expect(ok).toMatchObject({ success: true, update: { socialLinks: { instagram: "https://instagram.com/robinson" } } });
    for (const bad of ["http://x.com", "javascript:alert(1)", "facebook.com/x", "https://", "https://a b.com"]) {
      expect(profileExtrasUpdate(form({ facebookUrl: bad })).success, bad).toBe(false);
    }
  });
  it("lists the saved links with their names and ignores anything not https", () => {
    expect(socialLinkList({ facebook: "https://f.test/x", google: "javascript:alert(1)", other: "https://z.test" })).toEqual([
      { id: "facebook", label: "Facebook", url: "https://f.test/x" },
    ]);
  });
  it("allows the brand files and our own file storage only", () => {
    expect(safeLogoUrl("/brand/mark.svg")).toBe("/brand/mark.svg");
    expect(safeLogoUrl("https://abc123.public.blob.vercel-storage.com/logo.png")).toContain("blob.vercel-storage.com");
    for (const bad of ["/brand/other.svg", "https://evil.test/logo.png", "http://abc.public.blob.vercel-storage.com/x.png", "javascript:alert(1)", null, 5]) {
      expect(safeLogoUrl(bad), String(bad)).toBeNull();
    }
    expect(profileExtrasUpdate(form({ logoUrl: "https://evil.test/logo.png" })).success).toBe(false);
    expect(profileExtrasUpdate(form({ logoUrl: "" }))).toMatchObject({ success: true, update: { logoUrl: null } });
  });
});
