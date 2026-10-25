import { z } from "zod";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

/**
 * Quiet hours for texts that are not a live back-and-forth reply. Times are
 * minutes after midnight in Colorado (America/Denver), so the window follows
 * daylight saving automatically. The window may wrap past midnight (the
 * recommended 9:00 pm to 8:00 am does). Start and end equal means "never quiet".
 */
export const quietHoursSchema = z.object({
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
}).strict();
export type QuietHours = z.infer<typeof quietHoursSchema>;

/** Starting value shown to the owner: no texts from 9:00 pm until 8:00 am Colorado time. */
export const RECOMMENDED_QUIET_HOURS: QuietHours = { startMinute: 21 * 60, endMinute: 8 * 60 };

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
});

/** Minutes after midnight, Colorado time, for an instant. */
export function businessMinuteOfDay(at: Date): number {
  const parts = clock.formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return part("hour") * 60 + part("minute");
}

export function isInQuietHours(at: Date, window: QuietHours = RECOMMENDED_QUIET_HOURS): boolean {
  const { startMinute: start, endMinute: end } = window;
  if (start === end) return false;
  const now = businessMinuteOfDay(at);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** "9:00 pm" style label for an owner-facing screen. */
export function minuteLabel(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const mm = String(minute % 60).padStart(2, "0");
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${mm} ${suffix}`;
}

/** The next time a text may go out. Returns the instant itself when it is not quiet now. */
export function quietHoursEndAt(at: Date, window: QuietHours = RECOMMENDED_QUIET_HOURS): Date {
  if (!isInQuietHours(at, window)) return at;
  // Walk forward minute by minute so a daylight-saving jump can never be skipped or repeated wrongly.
  // A window is at most 24 hours long, so this stops within 1,440 steps.
  const stepMs = 60_000;
  let candidate = new Date(Math.floor(at.getTime() / stepMs) * stepMs);
  for (let i = 0; i < 1500; i++) {
    candidate = new Date(candidate.getTime() + stepMs);
    if (!isInQuietHours(candidate, window)) return candidate;
  }
  return at;
}

/** Plain-English sentence for the screen and for blocked-send messages. */
export function quietHoursSentence(window: QuietHours = RECOMMENDED_QUIET_HOURS): string {
  return window.startMinute === window.endMinute
    ? "Texts can go out at any hour."
    : `Texts are held from ${minuteLabel(window.startMinute)} until ${minuteLabel(window.endMinute)} Colorado time.`;
}
