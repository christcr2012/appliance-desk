import { BUSINESS_TIME_ZONE } from "@/lib/business-date";
import type { PromotionValue } from "./types";

/**
 * V-C3: when a promotion is showing. Decided at the moment of each page view from the stored UTC start and end
 * (no schedule job), so an ended promotion simply stops appearing and nothing else on the page changes.
 * The owner types and reads times in Colorado time; this only compares instants.
 */
export type PromotionState = "off" | "scheduled" | "live" | "ended";

export function promotionState(promotion: PromotionValue | undefined, now: Date): PromotionState {
  if (!promotion || !promotion.enabled) return "off";
  const t = now.getTime();
  if (promotion.startsAtUtc && t < Date.parse(promotion.startsAtUtc)) return "scheduled";
  if (promotion.endsAtUtc && t >= Date.parse(promotion.endsAtUtc)) return "ended";
  return "live";
}

/** The promotion to show now, or null. */
export function livePromotion(promotion: PromotionValue | undefined, now: Date): PromotionValue | null {
  return promotion && promotionState(promotion, now) === "live" ? promotion : null;
}

const FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

/** Colorado wording for the editor: "Starts Sat, Nov 1, 2026, 12:00 AM MDT / ends ... / visible now". */
export function describePromotionSchedule(promotion: PromotionValue | undefined, now: Date): string {
  const state = promotionState(promotion, now);
  if (!promotion || state === "off") return "Switched off. Visitors do not see it.";
  const starts = promotion.startsAtUtc ? FORMAT.format(new Date(promotion.startsAtUtc)) : null;
  const ends = promotion.endsAtUtc ? FORMAT.format(new Date(promotion.endsAtUtc)) : null;
  const window = [starts ? `starts ${starts}` : "starts as soon as it is published", ends ? `ends ${ends}` : "has no end date"].join(", ");
  const now1 = state === "live" ? "Visible now" : state === "scheduled" ? "Not visible yet" : "Ended, no longer visible";
  return `${now1}: ${window}.`;
}

/** The instant a Colorado wall-clock date and time means (DST aware). Input like "2026-11-01" and "00:00". */
export function denverLocalToUtc(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const wantY = +m[1], wantM = +m[2], wantD = +m[3], wantH = +t[1], wantMin = +t[2];
  const base = Date.UTC(wantY, wantM - 1, wantD, wantH, wantMin);
  // Colorado is UTC-7 (MST) or UTC-6 (MDT): try both and keep the one that reads back as the same wall time.
  for (const offsetHours of [6, 7]) {
    const candidate = new Date(base + offsetHours * 3_600_000);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(candidate);
    const get = (type: string) => +(parts.find((p) => p.type === type)?.value ?? "NaN");
    if (get("year") === wantY && get("month") === wantM && get("day") === wantD && get("hour") === wantH && get("minute") === wantMin) return candidate.toISOString();
  }
  return null; // a time that does not exist (spring-forward gap)
}
