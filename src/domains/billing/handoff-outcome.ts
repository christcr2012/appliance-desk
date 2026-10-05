export type HandoffWorkOutcome =
  | { state: "DONE"; detail?: string }
  | { state: "RETRY"; detail: string }
  | { state: "BLOCKED"; detail: string }
  | { state: "UNKNOWN"; detail: string };
