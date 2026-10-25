import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import type { DecisionSubject } from "./registry";

/** Pure rules of Decisions & reviews (DEC-1a): state, dates, value matching and the preview fingerprint. */
export type DecisionKind =
  | "STARTING_VALUE_APPLIED" | "CONFIRMED" | "CHANGED" | "SENT_TO_PROFESSIONAL" | "PROFESSIONAL_ANSWER" | "REOPENED";
export const DECISION_KINDS: DecisionKind[] = [
  "STARTING_VALUE_APPLIED", "CONFIRMED", "CHANGED", "SENT_TO_PROFESSIONAL", "PROFESSIONAL_ANSWER", "REOPENED",
];
export type DecisionState = "STARTING_VALUE" | "CONFIRMED" | "WITH_PROFESSIONAL" | "NO_SOURCE";
export const DECISION_STATES: DecisionState[] = ["STARTING_VALUE", "CONFIRMED", "WITH_PROFESSIONAL", "NO_SOURCE"];

export const PAST_DATE_MESSAGE = "A change can't apply to the past — signed and billed history stays as it was.";
export const CHANGED_SINCE_OPENED = "This changed since you opened it. Refresh to see the latest.";

/**
 * Spec section 3: the newest record decides. An "Other" professional answer (value null) is not applied to a setting,
 * so it leaves the subject where it was before any answer ("Needs a change to the app").
 */
export function decisionState(
  hasRecommendation: boolean,
  newestFirst: { kind: string; value: Prisma.JsonValue | null }[],
): DecisionState {
  const newest = newestFirst[0];
  if (newest && (newest.kind === "CONFIRMED" || newest.kind === "CHANGED" ||
      (newest.kind === "PROFESSIONAL_ANSWER" && newest.value !== null))) return "CONFIRMED";
  if (newest?.kind === "SENT_TO_PROFESSIONAL") return "WITH_PROFESSIONAL";
  return hasRecommendation ? "STARTING_VALUE" : "NO_SOURCE";
}

/** True when the newest record is a professional "Other" answer the app can't apply as a setting. */
export function needsAppChange(newestFirst: { kind: string; value: Prisma.JsonValue | null }[]): boolean {
  const newest = newestFirst[0];
  return newest?.kind === "PROFESSIONAL_ANSWER" && newest.value === null;
}

/** Stable JSON text (keys sorted) so equal values compare equal however they were built. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
}

export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export function previewFingerprint(preview: unknown): string {
  return createHash("sha256").update(canonicalJson(preview)).digest("hex");
}

/** The option matching a value (exact) or, for typed or imported answers, a label (case and spacing ignored). */
export function matchOption(subject: Pick<DecisionSubject, "options">, answer: Prisma.JsonValue | null | undefined) {
  if (answer === null || answer === undefined) return null;
  const exact = subject.options.find((option) => sameValue(option.value, answer));
  if (exact) return exact;
  if (typeof answer !== "string") return null;
  const words = answer.trim().replace(/\s+/g, " ").toLowerCase();
  return subject.options.find((option) => option.label.toLowerCase() === words) ?? null;
}

/**
 * When a decision starts, as a Colorado business date. Null or today → now; a later day → scheduled; an earlier
 * day → refused. Accepts "YYYY-MM-DD" or a Date (read as its Colorado calendar day).
 */
export function decisionStart(
  effectiveFrom: string | Date | null | undefined,
  now: Date = new Date(),
): { key: string; start: Date; later: boolean } {
  const today = businessDateKey(now);
  let key = today;
  if (effectiveFrom instanceof Date) {
    if (!Number.isFinite(effectiveFrom.getTime())) throw new Error("Pick a valid start date.");
    key = businessDateKey(effectiveFrom);
  } else if (typeof effectiveFrom === "string" && effectiveFrom.trim()) {
    key = effectiveFrom.trim();
  }
  const start = businessDateFromKey(key);
  if (!start || businessDateKey(start) !== key) throw new Error("Pick a valid start date.");
  if (key < today) throw new Error(PAST_DATE_MESSAGE);
  return { key, start, later: key > today };
}

export function cleanText(value: string | null | undefined, max: number, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Invalid ${name}.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`Keep the ${name} under ${max} characters.`);
  return trimmed || null;
}

/** The attachment must be a file in the private store under decisions/{subject}/ — never a public or outside link. */
export function decisionAttachmentProblem(url: string, storeId: string | null, subjectId: string): string | null {
  if (!storeId) return "File storage isn't set up here, so the completed form can't be attached.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "The attached form must be a file uploaded to the app's private storage.";
  }
  const host = `${storeId.slice("store_".length).toLowerCase()}.private.blob.vercel-storage.com`;
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== host || parsed.username || parsed.password ||
      parsed.port || parsed.search || parsed.hash) {
    return "The attached form must be a file uploaded to the app's private storage.";
  }
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return "The attached form must be a file uploaded to the app's private storage.";
  }
  const match = /^decisions\/([A-Z0-9-]+)\/[^/]+$/.exec(path);
  if (!match || (subjectId !== "*" && match[1] !== subjectId)) {
    return "The attached form must be stored with this question's files.";
  }
  return null;
}
