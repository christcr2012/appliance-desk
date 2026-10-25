// MCP-1 spec section 1: the one list of System health states. Pure (no database), so the page, the issue sweep,
// the readiness card and a future assistant connection all read the same words and colours.
import type { Tone } from "@/components/kit/types";

export const HEALTH_STATES = ["healthy", "late", "failing", "running", "unknown", "never-ran", "paused", "unconfigured"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** The kit has no "bad" tone; "danger" is its red (the spec's "bad"). The label is always shown next to the colour. */
export const HEALTH_PRESENTATION: Record<HealthState, { label: string; tone: Tone; meaning: string }> = {
  healthy: { label: "Working", tone: "good", meaning: "Ran on time and finished." },
  late: { label: "Late", tone: "attention", meaning: "Hasn't finished when it should have." },
  failing: { label: "Failed", tone: "danger", meaning: "The last run stopped with a problem." },
  running: { label: "Running now", tone: "info", meaning: "Started and not finished yet." },
  unknown: { label: "Not sure", tone: "attention", meaning: "The last run didn't report back." },
  "never-ran": { label: "Hasn't run yet", tone: "neutral", meaning: "No run recorded since it was added." },
  paused: { label: "Paused", tone: "neutral", meaning: "You paused it." },
  unconfigured: { label: "Needs setup", tone: "attention", meaning: "A setting it needs is missing." },
};
