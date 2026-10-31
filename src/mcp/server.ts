import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentContext } from "@/domains/agent-control/authorization";
import type { McpScope } from "@/mcp/scopes";
import { listRepairCases, getRepairCase } from "@/domains/agent-control/repair-cases";
import { getObservations, measure } from "@/domains/agent-control/performance";
import { createOptimizationProposal, listOptimizationProposals } from "@/domains/agent-control/optimization";
import { findSettings } from "@/mcp/settings-map";
import { listFeedbackForAgent, getFeedbackForAgent } from "@/domains/feedback/agent";
import { previewAgentOperation, executeAgentOperation, getAgentOperation } from "@/domains/agent-control/operations";
import {
  checkMcpActor, healthOverview, issuesList, issueGet, automationRuns,
  configurationReadiness, backupStatus, decisionsList, decisionGet,
} from "@/mcp/tools/diagnostics";

const readOnly = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
} as const;
const utc = z.string().nullable();
const basicRun = z.object({
  state: z.string(), startedUtc: utc, finishedUtc: utc,
  code: z.string().nullable(), stage: z.string().nullable(), reference: z.string().nullable(),
});
const issueShape = z.object({
  id: z.string(), kind: z.string(), severity: z.string(), status: z.string(),
  count: z.number(), firstSeenUtc: utc, lastSeenUtc: utc,
  failure: z.object({
    code: z.string().nullable(), stage: z.string().nullable(), reference: z.string().nullable(),
    explanation: z.string(), nextStep: z.string(),
  }).nullable(),
});
const decisionShape = z.object({
  id: z.string(), area: z.string(), title: z.string(), question: z.string(), state: z.string(),
  current: z.string(), recommended: z.string(), lastRecordedUtc: utc,
});

/**
 * Keep the text and structured views byte-for-byte consistent. A list larger than 8 KB
 * is shortened at its boundary, never cut in the middle of JSON or user text. If the
 * list supports a cursor, use the ID of the last *returned* row for the next page.
 */
export function boundMcpOutput(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw };
  const arrayName = ["issues", "runs", "decisions", "history", "recentRuns", "integrations", "jobs", "reports", "entries"]
    .find((key) => Array.isArray(result[key]));
  if (!arrayName) {
    if (JSON.stringify(result).length > 8192) throw new Error("TOOL_RESULT_TOO_LARGE");
    return result;
  }
  const original = result[arrayName] as unknown[];
  const rows = [...original];
  let removed = 0;
  // Reserve room for pagination metadata so page boundaries stay deterministic.
  while (JSON.stringify({ ...result, [arrayName]: rows }).length > 7900 && rows.length) {
    rows.pop();
    removed += 1;
  }
  if (removed) {
    if (!rows.length) throw new Error("TOOL_RESULT_TOO_LARGE");
    if (arrayName === "issues" || arrayName === "decisions" || arrayName === "jobs") {
      const last = rows.at(-1) as { id?: string; key?: string };
      result.nextCursor = arrayName === "jobs" ? last.key ?? null : last.id ?? null;
    }
    if (arrayName === "decisions") result.remaining = Number(result.remaining ?? 0) + removed;
    result.truncated = true;
  }
  result[arrayName] = rows;
  if (JSON.stringify(result).length > 8192) throw new Error("TOOL_RESULT_TOO_LARGE");
  return result;
}

function toolError(code: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: code }] };
}

/** One MCP server per authenticated HTTP request: neither identity nor scope is global state. */
export function buildMcpServer(context: AgentContext): McpServer {
  const server = new McpServer({ name: "appliance-desk", version: "1.0.0" });

  async function read(scope: McpScope, fn: () => Promise<Record<string, unknown>>) {
    if (!context.scopes.includes(scope)) return toolError("FORBIDDEN_SCOPE");
    try {
      await checkMcpActor(context);
      const data = boundMcpOutput(await fn());
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        structuredContent: data,
      };
    } catch (error) {
      // Never return a database/provider error message: it can carry customer data,
      // secrets, or a storage pathname.
      const code = error instanceof Error && error.message === "UNKNOWN_JOB" ?
        "UNKNOWN_JOB" : "TOOL_UNAVAILABLE";
      return toolError(code);
    }
  }

  const identity = {
    name: context.name,
    role: context.role,
    scopes: context.scopes,
    connectionLabel: context.connectionLabel,
    environment: process.env.VERCEL_ENV === "production" ? "production" : "testing",
    revision: process.env.VERCEL_GIT_COMMIT_SHA ?? "not reported",
  };
  server.registerTool("appliance_whoami", {
    title: "Who am I connected as?",
    description: "Shows this assistant's account and granted permissions.",
    inputSchema: z.strictObject({}),
    outputSchema: z.object({
      name: z.string(), role: z.enum(["OWNER", "ADMIN"]), scopes: z.array(z.string()),
      connectionLabel: z.string(), environment: z.enum(["production", "testing"]), revision: z.string(),
    }), annotations: readOnly,
  }, async () => ({
    content: [{ type: "text", text: JSON.stringify(identity) }],
    structuredContent: identity,
  }));

  server.registerTool("appliance_health_get_overview", {
    title: "System health", description: "Read safe scheduled job health states and next steps.",
    inputSchema: z.strictObject({
      cursor: z.string().regex(/^[a-z][a-z0-9:-]{0,79}$/).optional(),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    outputSchema: z.object({
      states: z.record(z.string(), z.number()),
      monitoring: z.object({ lastRunAt: utc, nextDueAt: utc, state: z.string() }).optional(),
      jobs: z.array(z.object({
        key: z.string(), title: z.string(), state: z.string(), explanation: z.string(),
        nextStep: z.string(), lastGoodUtc: utc, nextDueUtc: utc, nextDueDenver: utc,
        failureCode: z.string().nullable(), missingSettings: z.array(z.string()),
      })),
      nextCursor: z.string().nullable(), truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async ({ cursor, limit }) => read("ops:read", () => healthOverview(context, { cursor, limit })));

  server.registerTool("appliance_health_list_issues", {
    title: "Open system issues", description: "Page through issue codes and status without private reports.",
    inputSchema: z.strictObject({
      cursor: z.string().regex(/^c[a-z0-9]{10,50}$/i).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    outputSchema: z.object({
      issues: z.array(issueShape), nextCursor: z.string().nullable(),
      truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async ({ cursor, limit }) => read("ops:read", () => issuesList(context, { cursor, limit })));

  server.registerTool("appliance_health_get_issue", {
    title: "System issue detail", description: "Read one issue and its recent typed run outcomes.",
    inputSchema: z.strictObject({ id: z.string().regex(/^c[a-z0-9]{10,50}$/i) }),
    outputSchema: z.object({
      found: z.boolean(), issue: issueShape.nullable(),
      recentRuns: z.array(basicRun.extend({ job: z.string() })),
      truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async ({ id }) => read("ops:read", () => issueGet(context, id)));

  server.registerTool("appliance_automation_list_runs", {
    title: "Automation runs", description: "Last runs for one known job, with typed diagnostic codes.",
    inputSchema: z.strictObject({
      job: z.string().regex(/^[a-z][a-z0-9:-]{0,79}$/),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    outputSchema: z.object({
      job: z.string(), runs: z.array(basicRun.extend({ id: z.string() })),
      truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async ({ job, limit }) => read("ops:read", () => automationRuns(context, job, limit)));

  server.registerTool("appliance_configuration_get_readiness", {
    title: "Configuration readiness",
    description: "Read integration states, missing setting names and private-store readiness (never values).",
    inputSchema: z.strictObject({}),
    outputSchema: z.object({
      integrations: z.array(z.object({
        job: z.string(), state: z.string(), missingSettingNames: z.array(z.string()),
      })),
      privateStore: z.string(), truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async () => read("ops:read", () => configurationReadiness(context)));

  server.registerTool("appliance_backup_get_status", {
    title: "Verified backup status",
    description: "Read verified backup times, media totals, safe storage status and retention attention.",
    inputSchema: z.strictObject({}),
    outputSchema: z.object({
      latestVerifiedBackupUtc: utc, latestCompletePairUtc: utc, lastVerifiedMediaUtc: utc,
      photoCopies: z.object({
        copied: z.number().nullable(), unchanged: z.number().nullable(),
        missing: z.number().nullable(), tombstoned: z.number().nullable(),
      }),
      retentionDays: z.number(), retentionAttention: z.enum(["attention", "current"]),
      storage: z.enum(["configured", "not_configured"]),
    }), annotations: readOnly,
  }, async () => read("ops:read", () => backupStatus(context)));

  server.registerTool("appliance_decisions_list", {
    title: "Decisions and reviews", description: "Read safe question wording and private-answer status.",
    inputSchema: z.strictObject({
      cursor: z.string().max(80).regex(/^[A-Z][A-Z0-9-]+$/).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    outputSchema: z.object({
      decisions: z.array(decisionShape), remaining: z.number(),
      nextCursor: z.string().nullable(), truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async ({ cursor, limit }) => read("decisions:read", () => decisionsList(context, { cursor, limit })));

  server.registerTool("appliance_decisions_get", {
    title: "Decision detail", description: "Read one decision and answer-history dates, never freeform answers.",
    inputSchema: z.strictObject({ id: z.string().max(80).regex(/^[A-Z][A-Z0-9-]+$/) }),
    outputSchema: z.object({
      decision: decisionShape, history: z.array(z.object({
        id: z.string(), recordedUtc: utc, state: z.string(),
      })),
      truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async ({ id }) => read("decisions:read", () => decisionGet(context, id)));

  // Feedback text requires BOTH the triage grant and the distinct content grant,
  // plus the report author's still-current opt-in at every read. Pictures have no tool.
  const feedbackMeta = z.object({
    reportId: z.string(), number: z.number(), kind: z.string(), state: z.string(),
    routeTemplate: z.string(), reporterRole: z.string(), createdUtc: z.string(),
    updatedUtc: z.string(), aiReview: z.string(), hasContentAccess: z.boolean(),
  });
  server.registerTool("appliance_feedback_list_reports", {
    title: "App feedback list", description: "Read report states and page shapes; never written text or pictures.",
    inputSchema: z.strictObject({
      state: z.enum(["SUBMITTED","TRIAGED","NEEDS_INFORMATION","ACCEPTED","IN_PROGRESS",
        "AWAITING_VERIFICATION","RESOLVED","DUPLICATE","DECLINED","CLOSED"]).optional(),
      kind: z.enum(["BUG","IMPROVEMENT"]).optional(),
      cursor: z.string().regex(/^c[a-z0-9]{10,50}$/i).optional(),
      limit: z.number().int().min(1).max(10).default(10),
    }),
    outputSchema: z.object({
      reports: z.array(feedbackMeta), nextCursor: utc, truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async (input) => read("feedback:triage", () => listFeedbackForAgent(context, input)));

  server.registerTool("appliance_feedback_get_report", {
    title: "App feedback report",
    description: "Read metadata, and bounded text only when its author opted in and this assistant has the content scope. Never screenshots.",
    inputSchema: z.strictObject({ reportId: z.string().regex(/^c[a-z0-9]{10,50}$/i) }),
    outputSchema: z.object({
      found: z.boolean(),
      report: feedbackMeta.extend({
        title: utc, description: utc, expected: utc, steps: utc,
        entries: z.array(z.object({
          id: z.string(), visibility: z.string(), author: z.string(),
          createdUtc: z.string(), body: utc,
        })),
      }).nullable(), truncated: z.boolean().optional(),
    }), annotations: readOnly,
  }, async ({reportId}) => read("feedback:triage", () => getFeedbackForAgent(context, reportId)));

  // Repairs contain no customer report text, raw GitHub response, or internal
  // actor ID. Even the detail tool explicitly chooses safe, bounded fields.
  server.registerTool("appliance_repair_list_cases", {
    title: "Repair cases", description: "Read safe repair stages and evidence status.",
    inputSchema: z.strictObject({ limit: z.number().int().min(1).max(10).default(10) }),
    outputSchema: z.object({ cases: z.array(z.object({
      id: z.string(), number: z.number(), title: z.string(), sourceKind: z.string(),
      stage: z.string(), blocker: z.string().nullable(), prNumber: z.number().nullable(),
      updatedUtc: z.string(), verifiedUtc: utc,
    })) }), annotations: readOnly,
  }, async ({ limit }) => read("ops:read", async () => ({ cases:
    (await listRepairCases(context.userId, limit)).map(record => ({
      id: record.id, number: record.number, title: record.title,
      sourceKind: record.sourceKind, stage: record.stage, blocker: record.blocker,
      prNumber: record.prNumber, updatedUtc: record.updatedAt.toISOString(),
      verifiedUtc: record.verifiedAt?.toISOString() ?? null,
    })),
  })));

  server.registerTool("appliance_repair_get_case", {
    title: "Repair details", description: "Read one repair and its independently checked stages.",
    inputSchema: z.strictObject({ id: z.string().regex(/^c[a-z0-9]{10,50}$/i) }),
    outputSchema: z.object({ found: z.boolean(), repair: z.object({
      id: z.string(), number: z.number(), title: z.string(), sourceKind: z.string(),
      stage: z.string(), expectedBehavior: z.string(), howToCheck: z.string(),
      blocker: z.string().nullable(), prNumber: z.number().nullable(),
      verifiedUtc: utc, baselineRevision: z.string(), mergeSha: z.string().nullable(),
      deployedRevision: z.string().nullable(),
    }).nullable() }), annotations: readOnly,
  }, async ({ id }) => read("ops:read", async () => {
    const record = await getRepairCase(context.userId, id);
    return { found: Boolean(record), repair: record ? {
      id: record.id, number: record.number, title: record.title,
      sourceKind: record.sourceKind, stage: record.stage,
      expectedBehavior: record.expectedBehavior, howToCheck: record.howToCheck,
      blocker: record.blocker, prNumber: record.prNumber,
      verifiedUtc: record.verifiedAt?.toISOString() ?? null,
      baselineRevision: record.baselineRevision, mergeSha: record.mergeSha,
      deployedRevision: record.deployedRevision,
    } : null };
  }));

  server.registerTool("appliance_where_is_setting", {
    title: "Where is this setting?",
    description: "Find the real owner screen and the assistant's actual authority for a setting.",
    inputSchema: z.strictObject({ query: z.string().trim().min(2).max(100) }),
    outputSchema: z.object({ entries: z.array(z.object({
      key: z.string(), label: z.string(), href: z.string(), who: z.string(),
      mcpStatus: z.enum(["TOOL", "PLANNED", "NOT_APPLICABLE", "PROVIDER_MANUAL"]),
      reason: z.string(), action: z.string().optional(),
    })) }), annotations: readOnly,
  }, async ({ query }) => read("ops:read", async () => ({ entries: (await measure("QUERY", "settings-map-search", async () => findSettings(query))).map(item => ({
    key: item.key, label: item.label, href: item.href,
    who: item.who, mcpStatus: item.mcpStatus, reason: item.reason,
    ...(item.action ? { action: item.action } : {}),
  })) })));

  server.registerTool("appliance_optimization_get_observations", {
    title: "Measured app speed",
    description: "Read sampled durations and errors; fewer than 30 observations means not enough data.",
    inputSchema: z.strictObject({
      window: z.enum(["7d", "30d"]),
      kind: z.enum(["PAGE", "ACTION", "JOB", "QUERY"]).optional(),
    }),
    outputSchema: z.object({
      window: z.string(), start: z.string(), end: z.string(), truncated: z.boolean(),
      entries: z.array(z.object({
        kind: z.string(), name: z.string(), samples: z.number(), status: z.string(),
        message: z.string(), p50Ms: z.number().nullable(), p95Ms: z.number().nullable(),
        errorRatePercent: z.number().nullable(), previousSamples: z.number(),
        previousP95Ms: z.number().nullable(), p95ChangePercent: z.number().nullable(),
      })),
    }), annotations: readOnly,
  }, async ({ window, kind }) => read("ops:read", async () => {
    const result = await getObservations({ window, kind });
    return { ...result, entries: result.rows };
  }));

  server.registerTool("appliance_optimization_list_proposals", {
    title: "App improvement proposals",
    description: "View evidence-backed suggestions; no configuration change is applied automatically.",
    inputSchema: z.strictObject({ limit: z.number().int().min(1).max(20).default(10) }),
    outputSchema: z.object({ entries: z.array(z.object({
      number: z.number(), title: z.string(), state: z.string(), createdUtc: z.string(),
    })) }), annotations: readOnly,
  }, async ({ limit }) => read("ops:read", async () => ({ entries:
    (await listOptimizationProposals(context.userId, limit)).map(item => ({
      number: item.number, title: item.title, state: item.state,
      createdUtc: item.createdAt.toISOString(),
    })),
  })));

  const writePolicy = {
    readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  } as const;
  // Execute may change a live configuration; RTC and MCP both mark it guarded.
  const guardedWritePolicy = { ...writePolicy, destructiveHint: true } as const;
  const actionName = z.enum([
    "RUN_DIAGNOSTIC_SWEEP", "RETRY_DATABASE_BACKUP", "RETRY_MEDIA_COPY",
    "PAUSE_AUTOMATION", "RESUME_AUTOMATION", "VERIFY_RECOVERY_ARTIFACT", "APPLY_DECISION_ANSWERS",
    "REPAIR_CREATE_CASE", "REPAIR_LINK_EVIDENCE", "REPAIR_CHECK_CASE",
    "FEEDBACK_REPLY", "FEEDBACK_UPDATE", "FEEDBACK_LINK_CASE",
  ]);
  const previewResult = z.object({
    previewId: z.string(), state: z.string(), summary: z.string(),
    changes: z.array(z.object({ label: z.string(), now: z.string(), after: z.string() })),
    costNote: z.string().nullable(), approval: z.string(), expiresAt: z.string(),
  });
  const requestKeySchema = z.string().min(12).max(128).regex(/^[a-zA-Z0-9_-]+$/);
  const operationResult = z.object({
    id: z.string(), state: z.string(), action: z.string(), targetRef: z.string().nullable(),
    failureCode: z.string().nullable(), safeResult: z.unknown().nullable(),
    verification: z.unknown().nullable(), expiresAt: z.string(),
  });
  async function actionCall(scope: McpScope | null, fn: () => Promise<Record<string, unknown>>) {
    if (scope && !context.scopes.includes(scope)) return toolError("FORBIDDEN_SCOPE");
    try {
      await checkMcpActor(context);
      const data = boundMcpOutput(await fn());
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      const safe = [
        "FORBIDDEN_SCOPE", "OWNER_REQUIRED", "CONFLICT", "OWNER_APPROVAL_REQUIRED",
        "OPERATION_NOT_FOUND", "REQUEST_KEY_MISMATCH", "PREVIEW_CHANGED",
        "BACKUP_NOT_ELIGIBLE_FOR_RETRY", "UNKNOWN_AUTOMATION_RULE",
        "INVALID_ACTION_INPUT", "OPERATION_ARGUMENT_TAMPERED",
      ];
      const code = error instanceof Error && safe.includes(error.message) ? error.message : "ACTION_UNAVAILABLE";
      return toolError(code);
    }
  }

  server.registerTool("appliance_optimization_create_proposal", {
    title: "Propose an app improvement",
    description: "Record measured evidence and a reversible engineering suggestion, without changing app settings.",
    inputSchema: z.strictObject({
      title: z.string().min(3).max(160),
      window: z.enum(["7d", "30d"]),
      kind: z.enum(["PAGE", "ACTION", "JOB", "QUERY"]),
      name: z.string().min(2).max(100),
      settingKeys: z.array(z.string().max(100)).max(12).default([]),
      expectedBenefit: z.string().min(3).max(2000),
      risk: z.string().min(3).max(2000),
      costNote: z.string().min(3).max(500),
      measurementPlan: z.string().min(3).max(2000),
      rollback: z.string().min(3).max(2000),
    }),
    outputSchema: z.object({ id: z.string(), number: z.number(), state: z.string(), title: z.string() }),
    annotations: writePolicy,
  }, async ({ title, window, kind, name, settingKeys, expectedBenefit, risk, costNote, measurementPlan, rollback }) =>
    actionCall("repairs:write", () => createOptimizationProposal(context.userId, {
      title, observation: { window, kind, name },
      settingKeys, expectedBenefit, risk, costNote, measurementPlan, rollback,
    })));

  server.registerTool("appliance_action_preview", {
    title: "Preview a safe assistant action",
    description: "Show what would change, then request the owner's approval before doing anything.",
    inputSchema: z.strictObject({
      action: actionName, args: z.record(z.string(), z.unknown()),
      requestKey: z.string().min(12).max(128).regex(/^[a-zA-Z0-9_-]+$/),
    }),
    outputSchema: previewResult,
    annotations: writePolicy,
  }, async ({ action, args, requestKey }) => actionCall(
    action.startsWith("REPAIR_") ? "repairs:write" :
      action.startsWith("FEEDBACK_") ? "feedback:triage" :
      action === "APPLY_DECISION_ANSWERS" ? "decisions:apply" : "ops:maintain",
    () => previewAgentOperation(context, { action, args, requestKey }),
  ));

  // Every feedback mutation is a journal preview; execution requires
  // appliance_action_execute with the same requestKey and returned previewId.
  server.registerTool("appliance_feedback_reply", {
    title: "Propose an app-feedback reply",
    description: "Prepare an in-app reply with AI attribution. No email is sent.",
    inputSchema: z.strictObject({
      reportId: z.string().regex(/^c[a-z0-9]{10,50}$/i),
      expectedVersion: z.number().int().min(1),
      body: z.string().min(1).max(4000),
      visibility: z.enum(["REPORTER","INTERNAL"]), requestKey: requestKeySchema,
    }),
    outputSchema: previewResult, annotations: writePolicy,
  }, async ({requestKey, ...args}) => actionCall("feedback:triage",
    () => previewAgentOperation(context, {action:"FEEDBACK_REPLY",args,requestKey})));
  server.registerTool("appliance_feedback_update_report", {
    title: "Propose feedback status update",
    description: "Calling a report Fixed requires a linked VERIFIED repair case.",
    inputSchema: z.strictObject({
      reportId: z.string().regex(/^c[a-z0-9]{10,50}$/i),
      expectedVersion: z.number().int().min(1),
      toState: z.enum(["SUBMITTED","TRIAGED","NEEDS_INFORMATION","ACCEPTED","IN_PROGRESS",
        "AWAITING_VERIFICATION","RESOLVED","DUPLICATE","DECLINED","CLOSED"]),
      reason: z.string().max(500), requestKey: requestKeySchema,
    }),
    outputSchema: previewResult, annotations: writePolicy,
  }, async ({requestKey, ...args}) => actionCall("feedback:triage",
    () => previewAgentOperation(context, {action:"FEEDBACK_UPDATE",args,requestKey})));
  server.registerTool("appliance_feedback_link_case", {
    title: "Propose repair link",
    description: "Link a matching software case via journal; do not claim an unverified fix.",
    inputSchema: z.strictObject({
      reportId: z.string().regex(/^c[a-z0-9]{10,50}$/i),
      expectedVersion: z.number().int().min(1),
      caseId: z.string().regex(/^c[a-z0-9]{10,50}$/i), requestKey: requestKeySchema,
    }),
    outputSchema: previewResult, annotations: writePolicy,
  }, async ({requestKey, ...args}) => actionCall("feedback:triage",
    () => previewAgentOperation(context, {action:"FEEDBACK_LINK_CASE",args,requestKey})));
  // Every repair mutation is an MCP-5 journal PREVIEW, never a direct write.
  // Only the owner can approve the durable operation in the Assistant Activity
  // screen. Execute requires the original preview ID and request key.
  server.registerTool("appliance_repair_create_case", {
    title: "Propose a repair case", description: "Prepare a source-linked repair for owner approval. Does not create the case yet.",
    inputSchema: z.strictObject({
      sourceKind: z.enum(["SYSTEM_ISSUE", "FEEDBACK"]),
      sourceId: z.string().min(10).max(128).regex(/^[a-zA-Z0-9_-]+$/),
      expectedBehavior: z.string().min(1).max(2000), howToCheck: z.string().min(1).max(2000),
      requestKey: requestKeySchema,
    }), outputSchema: previewResult, annotations: writePolicy,
  }, async ({ sourceKind, sourceId, expectedBehavior, howToCheck, requestKey }) => actionCall(
    "repairs:write", () => previewAgentOperation(context, { action: "REPAIR_CREATE_CASE",
      args: { sourceKind, sourceId, expectedBehavior, howToCheck }, requestKey }),
  ));

  server.registerTool("appliance_repair_link_evidence", {
    title: "Propose pull request evidence", description: "Record a candidate PR only after owner approval. GitHub verification is separate.",
    inputSchema: z.strictObject({
      caseId: z.string().min(12).max(100), kind: z.literal("PR"),
      ref: z.string().regex(/^[1-9]\d{0,9}$/), requestKey: requestKeySchema,
    }), outputSchema: previewResult, annotations: writePolicy,
  }, async ({ caseId, kind, ref, requestKey }) => actionCall(
    "repairs:write", () => previewAgentOperation(context, { action: "REPAIR_LINK_EVIDENCE",
      args: { caseId, kind, ref }, requestKey }),
  ));

  server.registerTool("appliance_repair_check", {
    title: "Propose a fresh repair check", description: "Verify public GitHub, live revision and a later health run only after owner approval.",
    inputSchema: z.strictObject({ caseId: z.string().min(12).max(100), requestKey: requestKeySchema }),
    outputSchema: previewResult, annotations: writePolicy,
  }, async ({ caseId, requestKey }) => actionCall(
    "repairs:write", () => previewAgentOperation(context, { action: "REPAIR_CHECK_CASE",
      args: { caseId }, requestKey }),
  ));

  server.registerTool("appliance_action_execute", {
    title: "Execute a previously approved action",
    description: "Use only a fresh preview ID and its original request key; never repeat a completed effect.",
    inputSchema: z.strictObject({
      previewId: z.string().min(12).max(100),
      requestKey: z.string().min(12).max(128).regex(/^[a-zA-Z0-9_-]+$/),
    }),
    outputSchema: operationResult,
    annotations: guardedWritePolicy,
  }, async ({ previewId, requestKey }) => actionCall(
    null, () => executeAgentOperation(context, { previewId, requestKey }),
  ));

  server.registerTool("appliance_operation_get", {
    title: "Read the status of a past assistant action",
    description: "Read the verified outcome for one action owned by this connection.",
    inputSchema: z.strictObject({ operationId: z.string().min(12).max(100) }),
    outputSchema: operationResult, annotations: readOnly,
  }, async ({ operationId }) => actionCall(null,
    () => getAgentOperation(context, operationId)));


  return server;
}
