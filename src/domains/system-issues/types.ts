/** Typed system events only: never pass raw errors or customer fields. */
export type SystemIssueInput =
  | { kind: "AUTOMATION_FAILED"; ruleKey: string; runId: string; startedAt: Date; errorName: string; errorCode?: string }
  | { kind: "AUTOMATION_STALE"; ruleKey: string; lastSuccessAt: Date | null; expectedEveryHours: number }
  | { kind: "PROVIDER_OPERATION_STUCK"; operationKind: string; count: number; oldestSince: Date }
  | { kind: "TAX_LOOKUP_UNAVAILABLE"; count: number }
  | { kind: "SOURCE_PAGE_UNREACHABLE"; watchId: string; officialUrl: string; consecutiveFailures: number }
  | { kind: "SOURCE_PAGE_CHANGED"; watchId: string; officialUrl: string; contentHash: string }
  | { kind: "TAX_RATE_GUARDRAIL"; jurisdictionId: string; jurisdictionCode: string; asOf: Date; observationId: string }
  | { kind: "MESSAGE_DELIVERY_UNKNOWN"; count: number; oldestSince: Date }
  | { kind: "CONFIGURATION_MISSING"; ruleKey: string; missingVariableNames: string[] };
export type SystemIssueResolution = "SOURCE_SUCCEEDED" | "NO_STUCK_ITEMS" | "OWNER_REVIEWED";
