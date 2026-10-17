import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  DayTimeline,
  TIMELINE_END_MINUTES,
  TIMELINE_START_MINUTES,
  MIN_BLOCK_MINUTES,
  layoutDayVisits,
  visitStateWord,
  type TimelineVisit,
} from "@/components/ui/day-timeline";
import { businessMinuteOfDay } from "@/lib/business-date";

afterEach(cleanup);

const visit = (id: string, minutes: number | null, over: Partial<TimelineVisit> = {}): TimelineVisit => ({
  id,
  minutes,
  timeLabel: minutes === null ? "Time not set" : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`,
  customer: `Customer ${id}`,
  type: "DELIVERY",
  status: "SCHEDULED",
  href: `/desk/jobs/${id}`,
  ...over,
});

describe("V-4 day timeline placement", () => {
  it("places visits by time on the 8 am to 7 pm axis", () => {
    const { placed, outside } = layoutDayVisits([visit("b", 13 * 60), visit("a", 9 * 60 + 30)]);
    expect(outside).toEqual([]);
    expect(placed.map((p) => [p.visit.id, p.top])).toEqual([["a", 90], ["b", 300]]);
    expect(placed.every((p) => p.lane === 0 && p.lanes === 1)).toBe(true);
  });

  it("keeps untimed and out-of-range visits listed instead of dropping them", () => {
    const visits = [visit("none", null), visit("early", 7 * 60 + 59), visit("late", TIMELINE_END_MINUTES), visit("ok", TIMELINE_START_MINUTES)];
    const { placed, outside } = layoutDayVisits(visits);
    expect(placed.map((p) => p.visit.id)).toEqual(["ok"]);
    expect(outside.map((v) => v.id).sort()).toEqual(["early", "late", "none"]);
  });

  it("puts overlapping visits side by side and gives each cluster its own width", () => {
    const { placed } = layoutDayVisits([visit("a", 600), visit("b", 630), visit("c", 660), visit("d", 900)]);
    const byId = Object.fromEntries(placed.map((p) => [p.visit.id, p]));
    expect([byId.a.lane, byId.b.lane, byId.c.lane]).toEqual([0, 1, 0]);
    expect(byId.a.lanes).toBe(2);
    expect(byId.b.lanes).toBe(2);
    expect(byId.c.lanes).toBe(2);
    expect(byId.d.lanes).toBe(1);
  });

  it("never draws a block past the room the axis keeps under 7 pm", () => {
    const [last] = layoutDayVisits([visit("late", TIMELINE_END_MINUTES - 10)]).placed;
    expect(last.height).toBeGreaterThanOrEqual(MIN_BLOCK_MINUTES);
    expect(last.top + last.height).toBeLessThanOrEqual(TIMELINE_END_MINUTES - TIMELINE_START_MINUTES + MIN_BLOCK_MINUTES);
  });
});

describe("V-4 day timeline words", () => {
  it("says Done, In progress, Next, or the time", () => {
    expect(visitStateWord(visit("a", 600, { status: "COMPLETED" }), "a")).toBe("Done");
    expect(visitStateWord(visit("a", 600, { status: "IN_PROGRESS" }), null)).toBe("In progress");
    expect(visitStateWord(visit("a", 600), "a")).toBe("Next");
    expect(visitStateWord(visit("b", 660, { timeLabel: "11:00 AM MDT" }), "a")).toBe("11:00 AM MDT");
  });

  it("renders each visit as a link with its customer, type and word, plus the Now marker inside the axis", () => {
    render(
      <DayTimeline
        nowMinutes={12 * 60}
        nextId="b"
        visits={[visit("a", 9 * 60, { status: "COMPLETED" }), visit("b", 13 * 60), visit("c", null)]}
      />,
    );
    const list = screen.getByRole("list", { name: "Today's visits by time" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("href")).toBe("/desk/jobs/a");
    expect(items[0].textContent).toContain("Done");
    expect(items[1].textContent).toContain("Next");
    expect(screen.getByTestId("timeline-now")).toBeTruthy();
    // The untimed visit is still reachable.
    const rest = screen.getByText("Not on the timeline").parentElement as HTMLElement;
    expect(within(rest).getByRole("link", { name: /Customer c/ }).getAttribute("href")).toBe("/desk/jobs/c");
  });

  it("shows no Now marker before 8 am or after 7 pm", () => {
    render(<DayTimeline nowMinutes={7 * 60} nextId={null} visits={[visit("a", 600)]} />);
    expect(screen.queryByTestId("timeline-now")).toBeNull();
  });
});

describe("Colorado minute of day", () => {
  it("reads the Denver clock across both daylight-saving changes", () => {
    // 2026-07-01 18:30 UTC is 12:30 pm in Denver (MDT, UTC-6).
    expect(businessMinuteOfDay(new Date("2026-07-01T18:30:00Z"))).toBe(12 * 60 + 30);
    // 2026-01-15 18:30 UTC is 11:30 am in Denver (MST, UTC-7).
    expect(businessMinuteOfDay(new Date("2026-01-15T18:30:00Z"))).toBe(11 * 60 + 30);
    // Midnight Denver stays 0, never 1440.
    expect(businessMinuteOfDay(new Date("2026-07-01T06:00:00Z"))).toBe(0);
  });
});
