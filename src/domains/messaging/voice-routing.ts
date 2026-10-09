import { z } from "zod";

/** No implicit voice opt-in. Even a valid routing policy is inert until enabled. */
export const voiceRoutingSchema = z.object({
  timezone: z.literal("America/Denver"),
  forwardTo: z.string().regex(/^\+1[2-9][0-9]{9}$/),
  destinationVerifiedAt: z.string().datetime({ offset: true }),
  destinationApprovedAt: z.string().datetime({ offset: true }),
  timeoutSeconds: z.number().int().min(10).max(30),
  weeklyHours: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    from: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
    to: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  }).strict()).max(21),
  closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
  afterHoursMode: z.enum(["CLOSED", "VOICEMAIL"]),
  voicemail: z.object({
    enabled: z.boolean(),
    onMissedCall: z.boolean(),
    announcement: z.string().trim().min(20).max(400),
    maxSeconds: z.number().int().min(10).max(120),
    retentionDays: z.number().int().min(1).max(3650),
    approvedPolicyVersion: z.number().int().positive(),
  }).strict().optional(),
  greeting: z.string().trim().min(1).max(160),
  unavailableGreeting: z.string().trim().min(1).max(160),
}).strict();
export type VoiceRouting = z.infer<typeof voiceRoutingSchema>;

export type RouteDecision =
  | { kind: "DIAL"; destination: string; timeoutSeconds: number }
  | { kind: "CLOSED" | "UNAVAILABLE"; greeting: string }
  | { kind: "VOICEMAIL"; announcement: string; maxSeconds: number; retentionDays: number };

export const DEFAULT_VOICE_UNAVAILABLE = "Sorry, we cannot take your call right now.";

export function decideVoiceRoute(input: {
  enabled: boolean;
  policyVersion: number;
  approvedVersion: number;
  routing: unknown;
  accountReady: boolean;
  numberReady: boolean;
  /** Separate owner-authorized media switch; omitted stays OFF. */
  mediaActivated?: boolean;
  businessNumber: string;
  callerNumber: string;
  now: Date;
}): RouteDecision {
  const parsed = voiceRoutingSchema.safeParse(input.routing);
  if (!parsed.success || !input.enabled ||
      input.policyVersion !== input.approvedVersion ||
      !input.accountReady || !input.numberReady) {
    return { kind: "UNAVAILABLE", greeting: DEFAULT_VOICE_UNAVAILABLE };
  }
  const route = parsed.data;
  if (route.forwardTo === input.callerNumber || route.forwardTo === input.businessNumber) {
    return { kind: "UNAVAILABLE", greeting: route.unavailableGreeting };
  }
  if (new Date(route.destinationApprovedAt) > input.now ||
      new Date(route.destinationVerifiedAt) > input.now) {
    return { kind: "UNAVAILABLE", greeting: route.unavailableGreeting };
  }
  // IANA date formatting handles Denver daylight saving transitions.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit",
    day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdays[part("weekday")];
  const minute = `${part("hour")}:${part("minute")}`;
  if (weekday === undefined || route.closedDates.includes(date) ||
      !route.weeklyHours.some((h) => h.weekday === weekday &&
        h.from < h.to && minute >= h.from && minute < h.to)) {
    const voicemail = route.voicemail;
    if (route.afterHoursMode === "VOICEMAIL" && input.mediaActivated === true &&
        voicemail?.enabled === true &&
        voicemail.approvedPolicyVersion === input.policyVersion) {
      return { kind: "VOICEMAIL", announcement: voicemail.announcement,
        maxSeconds: voicemail.maxSeconds, retentionDays: voicemail.retentionDays };
    }
    return { kind: "CLOSED", greeting: route.greeting };
  }
  return { kind: "DIAL", destination: route.forwardTo, timeoutSeconds: route.timeoutSeconds };
}
