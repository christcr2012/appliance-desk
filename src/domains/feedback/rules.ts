import { z } from "zod";

// MCP-10a: pure app-feedback rules (no database): states and their words, allowed changes, input limits and the
// "Load more" cursor. The words never mix app feedback up with appliance repairs.

export const FEEDBACK_STATES = [
  "SUBMITTED", "TRIAGED", "NEEDS_INFORMATION", "ACCEPTED", "IN_PROGRESS", "AWAITING_VERIFICATION",
  "RESOLVED", "DUPLICATE", "DECLINED", "CLOSED",
] as const;
export type FeedbackStateName = (typeof FEEDBACK_STATES)[number];
export type FeedbackKindName = "BUG" | "IMPROVEMENT";

export const FINAL_STATES: readonly FeedbackStateName[] = ["RESOLVED", "DUPLICATE", "DECLINED", "CLOSED"];
export const REASON_REQUIRED: readonly FeedbackStateName[] = ["DECLINED", "DUPLICATE", "RESOLVED"];

export function isFinalState(state: FeedbackStateName): boolean {
  return FINAL_STATES.includes(state);
}

/** What the person who sent the report sees. */
export const REPORTER_STATE_WORDS: Record<FeedbackStateName, string> = {
  SUBMITTED: "Received",
  TRIAGED: "Being looked at",
  NEEDS_INFORMATION: "We have a question",
  ACCEPTED: "Planned",
  IN_PROGRESS: "Being worked on",
  AWAITING_VERIFICATION: "Ready to check",
  RESOLVED: "Fixed",
  DUPLICATE: "Already reported",
  DECLINED: "Not planned",
  CLOSED: "Closed",
};

/** What the owner and admins see: the same words, with "New" and "Waiting on them" for the two that need it. */
export const TEAM_STATE_WORDS: Record<FeedbackStateName, string> = {
  ...REPORTER_STATE_WORDS,
  SUBMITTED: "New",
  NEEDS_INFORMATION: "Waiting on them",
};

export type PillTone = "success" | "pending" | "attention" | "stopped" | "progress";

/** Owner pill: "They answered" (attention) whenever the reporter wrote last on an open report. */
export function teamPill(state: FeedbackStateName, awaitingTeam: boolean): { label: string; tone: PillTone } {
  if (awaitingTeam && !isFinalState(state) && state !== "SUBMITTED") return { label: "They answered", tone: "attention" };
  if (state === "SUBMITTED") return { label: "New", tone: "attention" };
  if (state === "NEEDS_INFORMATION") return { label: "Waiting on them", tone: "pending" };
  if (state === "RESOLVED") return { label: TEAM_STATE_WORDS[state], tone: "success" };
  if (isFinalState(state)) return { label: TEAM_STATE_WORDS[state], tone: "stopped" };
  return { label: TEAM_STATE_WORDS[state], tone: "progress" };
}

export function reporterPill(state: FeedbackStateName): { label: string; tone: PillTone } {
  if (state === "NEEDS_INFORMATION") return { label: REPORTER_STATE_WORDS[state], tone: "attention" };
  if (state === "RESOLVED") return { label: REPORTER_STATE_WORDS[state], tone: "success" };
  if (isFinalState(state)) return { label: REPORTER_STATE_WORDS[state], tone: "stopped" };
  return { label: REPORTER_STATE_WORDS[state], tone: "progress" };
}

const TRIAGE_TRANSITIONS: Record<FeedbackStateName, readonly FeedbackStateName[]> = {
  SUBMITTED: ["TRIAGED", "NEEDS_INFORMATION", "ACCEPTED", "DUPLICATE", "DECLINED"],
  TRIAGED: ["NEEDS_INFORMATION", "ACCEPTED", "DUPLICATE", "DECLINED"],
  NEEDS_INFORMATION: [],
  ACCEPTED: ["IN_PROGRESS", "DECLINED"],
  IN_PROGRESS: ["AWAITING_VERIFICATION", "ACCEPTED"],
  AWAITING_VERIFICATION: ["RESOLVED", "IN_PROGRESS"],
  RESOLVED: [],
  DUPLICATE: [],
  DECLINED: [],
  CLOSED: [],
};

/**
 * The states the owner/admin may move a report to from `from`. Any open report may also be marked RESOLVED (with a
 * reason: a recorded human resolution). DUPLICATE is only reachable through "Mark as already reported" (it needs the
 * other report's number), so it is never offered by the plain status change.
 */
export function allowedTriageTargets(from: FeedbackStateName, options: { includeDuplicate?: boolean } = {}): FeedbackStateName[] {
  if (isFinalState(from)) return [];
  const targets = new Set<FeedbackStateName>(TRIAGE_TRANSITIONS[from]);
  targets.add("RESOLVED");
  if (!options.includeDuplicate) targets.delete("DUPLICATE");
  return FEEDBACK_STATES.filter((state) => targets.has(state));
}

export function canTriageMove(from: FeedbackStateName, to: FeedbackStateName, options: { includeDuplicate?: boolean } = {}): boolean {
  return allowedTriageTargets(from, options).includes(to);
}

/** The reporter may reopen a finished report within the owner's reopen window, counted from when it was finished. */
export function canReopen(state: FeedbackStateName, closedAt: Date | null, reopenDays: number, now: Date): boolean {
  if (!isFinalState(state) || !closedAt) return false;
  return now.getTime() - closedAt.getTime() <= reopenDays * 86_400_000;
}

export class FeedbackError extends Error {
  constructor(message: string, readonly conflict = false) {
    super(message);
    this.name = "FeedbackError";
  }
}

export const NOT_FOUND = "Not found";
export const CHANGED = "This report changed since you opened it. Reload the page and try again.";
export const RATE_LIMITED = "You've sent several reports in the last hour. Please try again later.";
export const SCREENSHOT_TYPES = "Screenshots must be PNG, JPEG or WebP pictures.";
export const SCREENSHOT_TOO_LARGE = "This picture is too large to send — try a smaller screenshot.";
export const PICTURES_UNAVAILABLE = "Your report was sent, but pictures can't be saved right now.";

const trimmed = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} needs at least ${min} characters.`).max(max, `${label} can be at most ${max} characters.`);
const optionalTrimmed = (max: number, label: string) =>
  z.string().trim().max(max, `${label} can be at most ${max} characters.`).optional().transform((value) => (value ? value : null));

export const submitFeedbackSchema = z.object({
  kind: z.enum(["BUG", "IMPROVEMENT"], { message: "Choose what kind of feedback this is." }),
  title: trimmed(5, 160, "The short summary"),
  description: trimmed(10, 8000, "“Tell us more”"),
  expected: optionalTrimmed(2000, "“What did you expect?”"),
  steps: optionalTrimmed(4000, "“Steps”"),
  path: z.string().max(2000).optional().default("/"),
  requestKey: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "Reload the page and try again."),
});
export type SubmitFeedbackInput = z.input<typeof submitFeedbackSchema>;

export const messageSchema = trimmed(1, 4000, "The message");
export const reasonSchema = z.string().trim().min(3, "Give a reason (3–500 characters).").max(500, "Give a reason (3–500 characters).");
export const versionSchema = z.number().int().min(1);
export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** Optional reason: required (3–500) only for DECLINED, DUPLICATE and RESOLVED; otherwise trimmed and capped. */
export function checkReason(to: FeedbackStateName, reason: string | null | undefined): string | null {
  const value = (reason ?? "").trim();
  if (REASON_REQUIRED.includes(to)) return reasonSchema.parse(value);
  if (!value) return null;
  return value.slice(0, 500);
}

// ---------------------------------------------------------------------------
// KIT cursor rule: "Load more" grows the window. Order by (sortColumn desc, id desc); 50 more per click; cap 500.
// ---------------------------------------------------------------------------
export const PAGE_STEP = 50;
export const WINDOW_CAP = 500;

export type FeedbackCursor = { v: string; id: string };

export function encodeCursor(cursor: FeedbackCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): FeedbackCursor | null {
  if (!raw || raw.length > 400) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object") return null;
    const { v, id } = value as Record<string, unknown>;
    if (typeof v !== "string" || typeof id !== "string" || !idSchema.safeParse(id).success) return null;
    if (!Number.isFinite(Date.parse(v))) return null;
    return { v, id };
  } catch {
    return null;
  }
}

/** Given rows (already fetched one past the window) decide what to show and the next cursor. */
export function windowRows<T extends { id: string }>(rows: T[], windowSize: number, sortValue: (row: T) => Date) {
  const shown = rows.slice(0, windowSize);
  const more = rows.length > windowSize;
  const last = shown.at(-1);
  const atCap = windowSize >= WINDOW_CAP && more;
  return {
    rows: shown,
    nextCursor: more && !atCap && last ? encodeCursor({ v: sortValue(last).toISOString(), id: last.id }) : null,
    atCap,
  };
}

/** Short title for the To do list: "App feedback #12: <title up to 60 characters>". */
export function todoTitle(number: number, title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const short = clean.length > 60 ? clean.slice(0, 59).trimEnd() + "…" : clean;
  return `App feedback #${number}: ${short}`;
}

export function kindWords(kind: FeedbackKindName): string {
  return kind === "BUG" ? "Something isn't working" : "An idea";
}

export type FeedbackSettings = { maxAttachments: number; reopenDays: number };

export function validateFeedbackSettings(input: { maxAttachments: unknown; reopenDays: unknown }): FeedbackSettings {
  const maxAttachments = Number(input.maxAttachments);
  const reopenDays = Number(input.reopenDays);
  if (!Number.isInteger(maxAttachments) || maxAttachments < 0 || maxAttachments > 3) {
    throw new Error("Pictures per report must be a whole number from 0 to 3.");
  }
  if (!Number.isInteger(reopenDays) || reopenDays < 1 || reopenDays > 365) {
    throw new Error("Days to reopen must be a whole number from 1 to 365.");
  }
  return { maxAttachments, reopenDays };
}
