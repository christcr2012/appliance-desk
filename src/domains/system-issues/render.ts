import { ProviderOperationKind } from "@prisma/client";
import { AUTOMATION_RULES } from "@/domains/automation/health";
import { CORRELATION_ID, FAILURE_STAGE, failureExplanation, isFailureCode } from "@/domains/automation/failures";
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
  failure?: { code: string; stage: string; correlationId: string };
};
export function renderSystemIssue(input: SystemIssueInput): RenderedIssue {
  let fingerprint = "", summary = "", detail = "";
  let severity: RenderedIssue["severity"] = "MEDIUM";
  let watch: RenderedIssue["watch"];
  let failure: RenderedIssue["failure"];
  switch (input.kind) {
    case "AUTOMATION_FAILED":
      id(input.ruleKey); id(input.runId); date(input.startedAt);
      if (!AUTOMATION_RULES.some((rule) => rule.ruleKey === input.ruleKey)) throw new Error("Unrecognized automation rule");
      if (!knownErrorNames.has(input.errorName) || (input.errorCode && !knownErrorCodes.has(input.errorCode))) throw new Error("Unrecognized error code");
      fingerprint = "automation:" + input.ruleKey;
      severity = /^(billing|backup|media-copy)/.test(input.ruleKey) ? "HIGH" : "MEDIUM";
      summary = "A scheduled task did not complete.";
      if (input.failure) {
        if (!isFailureCode(input.failure.code) || !FAILURE_STAGE.test(input.failure.stage) ||
            !CORRELATION_ID.test(input.failure.correlationId)) throw new Error("Unrecognized failure record");
        failure = input.failure;
      }
      // Only allowlisted identifiers and the code's fixed explanation: never the original error text.
      detail = `Rule ${input.ruleKey}; run ${input.runId}; started ${date(input.startedAt)}; class ${input.errorName}; code ${input.failure?.code ?? input.errorCode ?? "UNCLASSIFIED"}.` +
        (input.failure ? " " + failureExplanation(input.failure.code).explain : "");
      break;
    case "BACKUP_RETENTION_ATTENTION":
      fingerprint = "backup-prune";
      severity = "MEDIUM";
      summary = "Old backup copies need tidying up.";
      detail = "Today's verified database backup is safe. Removing old copies didn't finish; storage may grow until this is fixed.";
      break;
    case "AUTOMATION_STALE":
      id(input.ruleKey); date(input.dueAt);
      if (!AUTOMATION_RULES.some((rule) => rule.ruleKey === input.ruleKey)) throw new Error("Unrecognized automation rule");
      if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 1 || input.graceMinutes > 1440) throw new Error("Invalid grace period");
      fingerprint = "automation-stale:" + input.ruleKey;
      summary = "A scheduled task is late.";
      detail = `Rule ${input.ruleKey}; was due ${date(input.dueAt)} (UTC) with ${input.graceMinutes} minutes' grace; last success ${input.lastSuccessAt ? date(input.lastSuccessAt) : "never"}.`;
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
    case "USE_TAX_FORM_MISSING":
      if (input.years.length === 0 || input.years.some((y) => !Number.isInteger(y))) throw new Error("Years required");
      fingerprint = "use-tax-form-missing"; severity = "MEDIUM";
      summary = `The ${input.years.join(" and ")} use tax form (DR 0252) is not loaded.`;
      detail = "Colorado's official consumer use tax form for this year is not in the app yet, so it can't be printed filled in. Filing still works from the numbers on the use tax page.";
      break;
    case "TAX_PERIOD_MISSING":
      count(input.count); fingerprint = "tax-period-missing"; severity = "HIGH";
      summary = "A tax return period has no filing To do.";
      detail = `${input.count} closed filing ${input.count === 1 ? "period has" : "periods have"} no return to file on the list. Open Taxes → Returns; the nightly job normally creates them.`;
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
    case "BOOKS_POSTING_FAILURE": {
      id(input.sourceType); id(input.sourceId);
      fingerprint = "books-post:" + input.sourceType + ":" + input.sourceId;
      severity = "HIGH";
      summary = "An accounting source could not be posted.";
      detail = "Source " + input.sourceType + " (" + input.sourceId + ") needs owner review of its financial evidence in Books. No journal was recorded for the failed event.";
      break;
    }
    case "BOOKS_STRIPE_CLEARING_DIFFERENCE": {
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.period) ||
          !Number.isSafeInteger(input.differenceCents) || input.differenceCents === 0)
        throw new Error("Invalid clearing evidence");
      fingerprint = "books-stripe-clearing:" + input.period;
      severity = "HIGH";
      summary = "Stripe balance and the accounting journal do not match.";
      detail = "At the end of " + input.period + " (Colorado), the clearing account differed by " +
        Math.abs(input.differenceCents) + " cents. Review imported Stripe transactions and Books before closing.";
      break;
    }
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
  return { fingerprint, kind: input.kind, severity, summary, detail, watch, ...(failure ? { failure } : {}) };
}
