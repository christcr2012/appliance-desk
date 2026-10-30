import { describe, expect, it } from "vitest";
import { parseVisitsParams } from "@/app/desk/jobs/params";
import { parseBoardParams } from "@/app/desk/dispatch/params";
import { parseRepairsParams } from "@/app/desk/maintenance/params";

describe("parseVisitsParams", () => {
  it("defaults to Upcoming, soonest first", () => {
    expect(parseVisitsParams({})).toEqual({
      tab: "upcoming",
      type: undefined,
      who: undefined,
      q: undefined,
      when: undefined,
      sort: "soonest",
      cursor: undefined,
    });
  });

  it("maps the spec's tab names", () => {
    expect(parseVisitsParams({ status: "no-time" }).tab).toBe("no-time");
    expect(parseVisitsParams({ status: "done" }).tab).toBe("done");
    expect(parseVisitsParams({ status: "cancelled" }).tab).toBe("cancelled");
  });

  it("maps old status links and ignores ?page=", () => {
    expect(parseVisitsParams({ status: "SCHEDULED" }).tab).toBe("upcoming");
    expect(parseVisitsParams({ status: "IN_PROGRESS" }).tab).toBe("upcoming");
    expect(parseVisitsParams({ status: "COMPLETED" }).tab).toBe("done");
    expect(parseVisitsParams({ status: "CANCELLED" }).tab).toBe("cancelled");
    expect(parseVisitsParams({ status: "done", page: "3" }).tab).toBe("done");
  });

  it("falls back to defaults for unknown values, never throws", () => {
    const parsed = parseVisitsParams({ status: "bogus", type: "bogus", when: "bogus", sort: "bogus" });
    expect(parsed.tab).toBe("upcoming");
    expect(parsed.type).toBeUndefined();
    expect(parsed.when).toBeUndefined();
    expect(parsed.sort).toBe("soonest");
  });

  it("maps the type words to job types", () => {
    expect(parseVisitsParams({ type: "delivery" }).type).toBe("DELIVERY");
    expect(parseVisitsParams({ type: "pickup" }).type).toBe("REMOVAL");
    expect(parseVisitsParams({ type: "repair" }).type).toBe("MAINTENANCE_VISIT");
    expect(parseVisitsParams({ type: "swap" }).type).toBe("SWAP");
    expect(parseVisitsParams({ type: "installation" }).type).toBe("INSTALLATION");
  });

  it("defaults Done and Cancelled to latest first; an explicit sort wins", () => {
    expect(parseVisitsParams({ status: "done" }).sort).toBe("latest");
    expect(parseVisitsParams({ status: "cancelled" }).sort).toBe("latest");
    expect(parseVisitsParams({ status: "done", sort: "soonest" }).sort).toBe("soonest");
    expect(parseVisitsParams({ status: "upcoming", sort: "latest" }).sort).toBe("latest");
  });

  it("passes who, q and the when presets through", () => {
    const parsed = parseVisitsParams({ who: "unassigned", q: "  ruiz ", when: "next-week" });
    expect(parsed.who).toBe("unassigned");
    expect(parsed.q).toBe("ruiz");
    expect(parsed.when).toBe("next-week");
  });
});

describe("parseBoardParams", () => {
  it("defaults to the day view with no date, who or open visit", () => {
    expect(parseBoardParams({})).toEqual({
      view: "day",
      date: undefined,
      who: undefined,
      open: undefined,
    });
  });

  it("accepts the week and agenda views and a real calendar date", () => {
    expect(parseBoardParams({ view: "week" }).view).toBe("week");
    expect(parseBoardParams({ view: "agenda" }).view).toBe("agenda");
    expect(parseBoardParams({ date: "2026-10-30" }).date).toBe("2026-10-30");
  });

  it("rejects impossible or misshapen dates and unknown views", () => {
    expect(parseBoardParams({ date: "2026-02-30" }).date).toBeUndefined();
    expect(parseBoardParams({ date: "10/30/2026" }).date).toBeUndefined();
    expect(parseBoardParams({ view: "month" }).view).toBe("day");
  });

  it("passes who and open through, trimmed", () => {
    const parsed = parseBoardParams({ who: " unassigned ", open: " job-1 " });
    expect(parsed.who).toBe("unassigned");
    expect(parsed.open).toBe("job-1");
  });
});

describe("parseRepairsParams", () => {
  it("defaults to Open, newest first", () => {
    expect(parseRepairsParams({})).toEqual({
      tab: "open",
      priority: undefined,
      q: undefined,
      sort: "newest",
      cursor: undefined,
    });
  });

  it("maps the spec's tab names and the old status links", () => {
    expect(parseRepairsParams({ status: "new" }).tab).toBe("new");
    expect(parseRepairsParams({ status: "SUBMITTED" }).tab).toBe("new");
    expect(parseRepairsParams({ status: "REVIEWING" }).tab).toBe("open");
    expect(parseRepairsParams({ status: "IN_PROGRESS" }).tab).toBe("open");
    expect(parseRepairsParams({ status: "RESOLVED" }).tab).toBe("fixed");
    expect(parseRepairsParams({ status: "fixed" }).tab).toBe("fixed");
    expect(parseRepairsParams({ status: "CLOSED" }).tab).toBe("closed");
    expect(parseRepairsParams({ status: "fixed", page: "2" }).tab).toBe("fixed");
  });

  it("maps the priority filter and sorts, falling back safely", () => {
    expect(parseRepairsParams({ priority: "urgent" }).priority).toBe("URGENT");
    expect(parseRepairsParams({ priority: "high" }).priority).toBe("HIGH");
    expect(parseRepairsParams({ priority: "low" }).priority).toBeUndefined();
    expect(parseRepairsParams({ sort: "priority" }).sort).toBe("priority");
    expect(parseRepairsParams({ sort: "oldest" }).sort).toBe("oldest");
    expect(parseRepairsParams({ sort: "bogus" }).sort).toBe("newest");
  });
});
