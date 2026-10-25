import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appRevisionFrom, browserFromUserAgent, describeRouteTemplate, deviceFromUserAgent, readSafeContext, safeContextFrom,
  toRouteTemplate,
} from "@/domains/feedback/context";
import {
  allowedTriageTargets, canReopen, canTriageMove, checkReason, decodeCursor, encodeCursor, isFinalState, reporterPill,
  submitFeedbackSchema, teamPill, todoTitle, windowRows, REPORTER_STATE_WORDS, TEAM_STATE_WORDS,
} from "@/domains/feedback/rules";
import { validateFeedbackSettings } from "@/domains/feedback/rules";

// MCP-10a: what a report captures about the page, and the pure rules (states, words, limits, cursor).

describe("toRouteTemplate keeps only the page's shape", () => {
  it("replaces record ids, digits and UUIDs with [id] and drops the query and hash", () => {
    expect(toRouteTemplate("/account/rentals/cmh3k2l9x0000abcdefghijk?tab=bills#top")).toBe("/account/rentals/[id]");
    expect(toRouteTemplate("/desk/customers/1234/locations")).toBe("/desk/customers/[id]/locations");
    expect(toRouteTemplate("/sign/123e4567-e89b-12d3-a456-426614174000")).toBe("/sign/[id]");
    expect(toRouteTemplate("/desk/jobs/ci-security-job-0000001/work-order")).toBe("/desk/jobs/[id]/work-order");
    expect(toRouteTemplate("/account/billing?token=secret-reset-token-value")).toBe("/account/billing");
    expect(toRouteTemplate("/")).toBe("/");
    expect(toRouteTemplate("/pricing")).toBe("/pricing");
  });
  it("turns anything unknown or unsafe into /", () => {
    for (const bad of ["https://evil.example/desk", "//evil.example", "desk/today", "/api/photos/abc", "/_next/static/x",
      "/desk/../account", "/account/%E0%A4%A", "/account/a b", "/desk/customers/someone@example.com", 42, null, undefined]) {
      expect(toRouteTemplate(bad), String(bad)).toBe("/");
    }
  });
  it("caps the template at 200 characters", () => {
    expect(toRouteTemplate("/desk/" + "abc/".repeat(80)).length).toBeLessThanOrEqual(200);
  });
});

describe("user-agent buckets (the raw text is never stored)", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const edge = chromeWin + " Edg/130.0.0.0";
  const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
  const androidPhone = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
  const androidTablet = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  it("finds the browser family", () => {
    expect(browserFromUserAgent(iphone)).toBe("safari");
    expect(browserFromUserAgent(chromeWin)).toBe("chrome");
    expect(browserFromUserAgent(edge)).toBe("edge");
    expect(browserFromUserAgent(firefox)).toBe("firefox");
    expect(browserFromUserAgent("curl/8.0")).toBe("other");
    expect(browserFromUserAgent(null)).toBe("other");
  });
  it("finds the device class", () => {
    expect(deviceFromUserAgent(iphone)).toBe("phone");
    expect(deviceFromUserAgent(androidPhone)).toBe("phone");
    expect(deviceFromUserAgent(ipad)).toBe("tablet");
    expect(deviceFromUserAgent(androidTablet)).toBe("tablet");
    expect(deviceFromUserAgent(chromeWin)).toBe("computer");
    expect(deviceFromUserAgent(undefined)).toBe("computer");
  });
  it("stores only language, browser and device", () => {
    expect(safeContextFrom(iphone, "es")).toEqual({ language: "es", browser: "safari", device: "phone" });
    expect(Object.keys(safeContextFrom(chromeWin, "fr")).sort()).toEqual(["browser", "device", "language"]);
    expect(safeContextFrom(chromeWin, "fr").language).toBe("en");
    expect(readSafeContext({ browser: "netscape", device: "fridge", extra: "x" })).toEqual({ language: "en", browser: "other", device: "computer" });
  });
  it("keeps the first 12 characters of a real commit only", () => {
    expect(appRevisionFrom("ABCDEF1234567890abcdef1234567890abcdef12")).toBe("abcdef123456");
    expect(appRevisionFrom(undefined)).toBeNull();
    expect(appRevisionFrom("not a sha")).toBeNull();
  });
  it("describes a page in plain words", () => {
    expect(describeRouteTemplate("/account/rentals/[id]")).toBe("My account › Rentals › a record");
    expect(describeRouteTemplate("/")).toBe("Website home");
  });
});

describe("states, words and allowed changes", () => {
  it("never mixes app feedback up with appliance repairs", () => {
    const words = JSON.stringify([REPORTER_STATE_WORDS, TEAM_STATE_WORDS]);
    expect(words).not.toMatch(/repair|maintenance|technician|visit/i);
    expect(REPORTER_STATE_WORDS.NEEDS_INFORMATION).toBe("We have a question");
    expect(TEAM_STATE_WORDS.SUBMITTED).toBe("New");
    expect(TEAM_STATE_WORDS.NEEDS_INFORMATION).toBe("Waiting on them");
  });
  it("follows the spec's triage transitions, and any open report may be marked Fixed", () => {
    expect(allowedTriageTargets("SUBMITTED")).toEqual(["TRIAGED", "NEEDS_INFORMATION", "ACCEPTED", "RESOLVED", "DECLINED"]);
    expect(canTriageMove("SUBMITTED", "DUPLICATE")).toBe(false);
    expect(canTriageMove("SUBMITTED", "DUPLICATE", { includeDuplicate: true })).toBe(true);
    expect(canTriageMove("ACCEPTED", "IN_PROGRESS")).toBe(true);
    expect(canTriageMove("ACCEPTED", "TRIAGED")).toBe(false);
    expect(canTriageMove("IN_PROGRESS", "AWAITING_VERIFICATION")).toBe(true);
    expect(canTriageMove("NEEDS_INFORMATION", "RESOLVED")).toBe(true);
    expect(canTriageMove("NEEDS_INFORMATION", "ACCEPTED")).toBe(false);
    for (const final of ["RESOLVED", "DUPLICATE", "DECLINED", "CLOSED"] as const) {
      expect(isFinalState(final)).toBe(true);
      expect(allowedTriageTargets(final)).toEqual([]);
    }
  });
  it("requires a 3–500 character reason for Fixed, Not planned and Already reported", () => {
    expect(() => checkReason("RESOLVED", "")).toThrow(/reason/);
    expect(() => checkReason("DECLINED", "no")).toThrow(/reason/);
    expect(() => checkReason("DUPLICATE", "x".repeat(501))).toThrow(/reason/);
    expect(checkReason("RESOLVED", "  Fixed in the new version  ")).toBe("Fixed in the new version");
    expect(checkReason("ACCEPTED", "")).toBeNull();
  });
  it("allows reopening only within the reopen window after a report is finished", () => {
    const closed = new Date("2026-10-01T12:00:00Z");
    expect(canReopen("RESOLVED", closed, 90, new Date("2026-12-29T12:00:00Z"))).toBe(true);
    expect(canReopen("RESOLVED", closed, 90, new Date("2026-12-31T12:00:00Z"))).toBe(false);
    expect(canReopen("TRIAGED", null, 90, closed)).toBe(false);
    expect(canReopen("CLOSED", null, 90, closed)).toBe(false);
  });
  it("shows the owner the right pill", () => {
    expect(teamPill("SUBMITTED", true)).toEqual({ label: "New", tone: "attention" });
    expect(teamPill("TRIAGED", true)).toEqual({ label: "They answered", tone: "attention" });
    expect(teamPill("NEEDS_INFORMATION", false)).toEqual({ label: "Waiting on them", tone: "pending" });
    expect(reporterPill("DUPLICATE").label).toBe("Already reported");
  });
  it("makes the To do title short", () => {
    expect(todoTitle(12, "Short")).toBe("App feedback #12: Short");
    expect(todoTitle(3, "x".repeat(100)).length).toBeLessThanOrEqual("App feedback #3: ".length + 60);
  });
});

describe("form limits", () => {
  const base = { kind: "BUG", title: "Button broken", description: "The Save button does nothing.", requestKey: randomUUID() };
  it("trims and accepts a good report", () => {
    const parsed = submitFeedbackSchema.parse({ ...base, title: "  Button broken  ", expected: "  ", steps: "1. Tap Save" });
    expect(parsed.title).toBe("Button broken");
    expect(parsed.expected).toBeNull();
    expect(parsed.steps).toBe("1. Tap Save");
  });
  it("refuses short, long and malformed fields", () => {
    expect(submitFeedbackSchema.safeParse({ ...base, title: "Hey" }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, title: "x".repeat(161) }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, description: "short" }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, description: "x".repeat(8001) }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, expected: "x".repeat(2001) }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, steps: "x".repeat(4001) }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, kind: "REPAIR" }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, requestKey: "bad key!" }).success).toBe(false);
  });
  it("keeps the owner settings inside their ranges", () => {
    expect(validateFeedbackSettings({ maxAttachments: 0, reopenDays: 1 })).toEqual({ maxAttachments: 0, reopenDays: 1 });
    expect(() => validateFeedbackSettings({ maxAttachments: 4, reopenDays: 90 })).toThrow();
    expect(() => validateFeedbackSettings({ maxAttachments: 3, reopenDays: 0 })).toThrow();
    expect(() => validateFeedbackSettings({ maxAttachments: 1.5, reopenDays: 90 })).toThrow();
  });
});

describe("Load more cursor (KIT rule)", () => {
  it("round-trips and refuses tampering", () => {
    const cursor = { v: "2026-10-25T12:00:00.000Z", id: "abc123" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: "x", id: "abc" })).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: cursor.v, id: "a'; DROP" })).toString("base64url"))).toBeNull();
  });
  it("shows the window, offers more only when one more row exists, and stops at the cap", () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, at: new Date(2026, 0, 1, 0, 0, 60 - i) }));
    const page = windowRows(rows, 50, (row) => row.at);
    expect(page.rows).toHaveLength(50);
    expect(decodeCursor(page.nextCursor)?.id).toBe("r49");
    expect(windowRows(rows.slice(0, 50), 50, (row) => row.at).nextCursor).toBeNull();
    const capped = windowRows(Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, at: new Date() })), 500, (row) => row.at);
    expect(capped.atCap).toBe(true);
    expect(capped.nextCursor).toBeNull();
  });
});
