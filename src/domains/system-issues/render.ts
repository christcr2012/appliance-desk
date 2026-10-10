import { ProviderOperationKind } from "@prisma/client";
import { AUTOMATION_RULES } from "@/domains/automation/health";
import type { SystemIssueInput } from "./types";

const identifier = /^[a-zA-Z0-9_.:-]{1,100}$/;
const knownErrorNames = new Set(["Error", "TypeError", "TimeoutError", "AbortError", "FetchError", "PrismaClientKnownRequestError", "PrismaClientInitializationError", "TaxLookupUnavailable", "ProviderTimeoutError", "UnknownError"]);
const knownErrorCodes = new Set(["UNKNOWN", "UNCLASSIFIED", "P1001", "P1002", "P2002", "P2024", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "STRIPE_TIMEOUT", "REQUEST_TIMEOUT", "HTTP_429", "HTTP_500", "HTTP_503"]);
function id(v: string) {
  if (typeof v !== "string" || !identifier.test(v)) throw new Error("Invalid issue identifier");
  return v;
}
function date(v: Date) {
  if (!(v instanceof Date) || !Number.isFinite(v.getTime())) throw new Error("Invalid issue date");
  return v.toISOString();
}
function count(v: number) {
  if (!Number.isSafeInteger(v) || v < 1 || v > 1000000) throw new Error("Invalid issue count");
  return v;
}
export type RenderedIssue = {
  fingerprint: string;
  kind: SystemIssueInput["kind"];
  severity: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  detail: string;
  watch?: { id: string; url: string };
};
export function renderSystemIssue(input: SystemIssueInput): RenderedIssue {
  let fingerprint = "", summary = "", detail = "";
  let severity: RenderedIssue["severity"] = "MEDIUM";
  let watch: RenderedIssue["watch"];
  switch (input.kind) {
    case "AUTOMATION_FAILED":
      id(input.ruleKey); id(input.runId); date(input.startedAt);
      if (!AUTOMATION_RULES.some((rule) => rule.ruleKey === input.ruleKey)) throw new Error("Unrecognized automation rule");
      if (!knownErrorNames.has(input.errorName) || (input.errorCode && !knownErrorCodes.has(input.errorCode))) throw new Error("Unrecognized error code");
      fingerprint = "automation:" + input.ruleKey;
      severity = /^(billing|backup|media-copy)/.test(input.ruleKey) ? "HIGH" : "MEDIUM";
      summary = "A scheduled task did not complete.";
      detail = `Rule ${input.ruleKey}; run ${input.runId}; started ${date(input.startedAt)}; class ${input.errorName}; code ${input.errorCode ?? "UNCLASSIFIED"}.`;
      break;
    case "AUTOMATION_STALE":
      id(input.ruleKey);
      if (!AUTOMATION_RULES.some((rule) => rule.ruleKey === input.ruleKey)) throw new Error("Unrecognized automation rule");
      if (![24,168,744].includes(input.expectedEveryHours)) throw new Error("Invalid task frequency");
      fingerprint = "automation-stale:" + input.ruleKey;
      summary = "A scheduled task has not completed recently.";
      detail = `Rule ${input.ruleKey}; expected every ${input.expectedEveryHours} hours; last success ${input.lastSuccessAt ? date(input.lastSuccessAt) : "never"}.`;
      break;
    case "PROVIDER_OPERATION_STUCK":
      id(input.operationKind); count(input.count);
      if (!Object.values(ProviderOperationKind).some((v) => v === input.operationKind)) throw new Error("Unrecognized provider operation");
      fingerprint = "provider-op:" + input.operationKind; severity = "HIGH";
      summary = "A provider operation needs checking.";
      detail = `Operation ${input.operationKind}; count ${input.count}; oldest ${date(input.oldestSince)}. Check provider status before retrying.`;
      break;
    case "TAX_LOOKUP_UNAVAILABLE":
      count(input.count); fingerprint = "tax-lookup";
      summary = "Colorado address lookup is unavailable.";
      detail = `Consecutive failures ${input.count}. Manual verification required.`;
      break;
    case "SOURCE_PAGE_UNREACHABLE":
    case "SOURCE_PAGE_CHANGED": {
      id(input.watchId);
      const url = new URL(input.officialUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Invalid official source");
      watch = { id: input.watchId, url: url.href };
      severity = "LOW";
      if (input.kind === "SOURCE_PAGE_UNREACHABLE") {
        count(input.consecutiveFailures);
        fingerprint = "source-page:" + input.watchId;
        summary = "An official page could not be checked.";
        detail = `Watch ${input.watchId}; failed checks ${input.consecutiveFailures}.`;
      } else {
        if (!/^[0-9a-f]{16,128}$/i.test(input.contentHash)) throw new Error("Invalid page hash");
        fingerprint = `source-page-changed:${input.watchId}:${input.contentHash}`;
        summary = "An official information page changed.";
        detail = `Watch ${input.watchId}; content hash ${input.contentHash}. Review manually.`;
      }
      break;
    }
    case "TAX_RATE_GUARDRAIL":
      id(input.jurisdictionId); id(input.jurisdictionCode); id(input.observationId);
      fingerprint = `tax-rate:${input.jurisdictionId}:${date(input.asOf).slice(0,10)}`;
      summary = "A proposed tax rate needs review.";
      detail = `Jurisdiction ${input.jurisdictionCode}; as of ${date(input.asOf).slice(0,10)}; observation ${input.observationId}.`;
      break;
    case "MESSAGE_DELIVERY_UNKNOWN":
      count(input.count);
      fingerprint = "message-unknown";
      summary = "Messages have unknown delivery status.";
      detail = `Count ${input.count}; oldest ${date(input.oldestSince)}. Check delivery records before resending.`;
      break;
    case "TELECOM_SYNC_STALE":
      id(input.scope); date(input.lastSuccessAt);
      if (input.lastFailureAt) date(input.lastFailureAt);
      fingerprint = "telecom-sync:" + input.scope; severity = "HIGH";
      summary = "Telecom provider usage data needs attention.";
      detail = `Last successful sync ${date(input.lastSuccessAt)}. Check private telecom setup and resync; prior evidence is retained.`;
      break;
    case "TELECOM_STATEMENT_DIFFERENCE":
      id(input.scope);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.period)) throw new Error("Invalid provider period");
      fingerprint = "telecom-statement:" + input.scope + ":" + input.period; severity = "HIGH";
      summary = "Telecom statement differs from reported charges.";
      detail = `Provider GMT period ${input.period}; review verified statement and account usage separately in private Reports.`;
      break;
    case "TELECOM_CONTACTS_UNRESOLVED":
      if (![input.threadCount,input.unlinkedMissedCalls].every(n=>Number.isSafeInteger(n) && n>=0 && n<=1000000) ||
          input.threadCount+input.unlinkedMissedCalls===0) throw new Error("Invalid contact count");
      fingerprint = "telecom-unresolved"; severity = "HIGH";
      summary = "Customer communications need follow-up.";
      detail = `Unresolved threads ${input.threadCount}; missed calls without threads ${input.unlinkedMissedCalls}. Review the private inbox.`;
      break;
    case "CONFIGURATION_MISSING": {
      id(input.ruleKey);
      const rule = AUTOMATION_RULES.find((item) => item.ruleKey === input.ruleKey);
      if (!rule || input.missingVariableNames.length < 1 || !input.missingVariableNames.every((name) => rule.requiredEnv.includes(name))) throw new Error("Unrecognized configuration name");
      fingerprint = "config:" + input.ruleKey; severity = "HIGH";
      summary = "A scheduled task is missing setup.";
      detail = `Rule ${input.ruleKey}; missing variable names: ${[...new Set(input.missingVariableNames)].join(", ")}.`;
      break;
    }
    default: { const impossible: never = input; throw new Error("Unknown system issue kind: " + String(impossible)); }
  }
  if (fingerprint.length > 240 || detail.length > 4096) throw new Error("Oversized issue");
  return { fingerprint, kind: input.kind, severity, summary, detail, watch };
}
