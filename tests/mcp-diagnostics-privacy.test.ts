import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "../src/domains/agent-control/authorization";
import {
  healthOverview, issuesList, issueGet, automationRuns, configurationReadiness,
  backupStatus, decisionsList, decisionGet, safeDecisionWords,
} from "../src/mcp/tools/diagnostics";

const hidden = "CANARY_PRIVATE_PERSON_EMAIL_PHONE_PATH_AND_REPORT";
const f = vi.hoisted(() => ({
  guard: vi.fn(), health: vi.fn(), issues: vi.fn(), list: vi.fn(), get: vi.fn(),
  issue: vi.fn(), runs: vi.fn(), manifest: vi.fn(), backup: vi.fn(), tx: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $transaction: f.tx,
    systemIssue: { findUnique: f.issue },
    automationRun: { findMany: f.runs },
    backupArtifact: { findFirst: f.manifest },
  },
}));
vi.mock("../src/lib/team-actor", () => ({ assertActiveTeamActor: f.guard }));
vi.mock("../src/domains/automation/health", () => ({
  AUTOMATION_RULES: [{ ruleKey: "backup" }],
  getAutomationHealth: f.health,
}));
vi.mock("../src/domains/system-issues/queries", () => ({ listSystemIssues: f.issues }));
vi.mock("../src/domains/decisions", () => ({ listDecisions: f.list, getDecision: f.get }));
vi.mock("../src/domains/backup/dashboard", () => ({ getBackupDashboard: f.backup }));

const actor: AgentContext = {
  userId: "owner-1", name: "Owner", role: "OWNER", connectionId: "connection-1",
  connectionLabel: "test connection", scopes: ["ops:read", "decisions:read"],
};
const date = new Date("2026-10-27T16:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  f.tx.mockImplementation(async (cb: (tx: object) => Promise<unknown>) => cb({}));
  f.guard.mockResolvedValue(undefined);
  f.health.mockResolvedValue([{
    ruleKey: "backup", label: "Nightly backups", state: "working",
    explanation: "Backups are scheduled", nextDueAt: date, lastSuccessAt: date,
    lastFailure: { code: "PROVIDER_UNREACHABLE", rawResponse: hidden },
    missingEnv: ["CRON_SECRET"], internalLog: hidden,
  }]);
  f.issues.mockResolvedValue({
    rows: [{
      id: "c1234567890123", kind: "AUTOMATION_FAILED", severity: "HIGH",
      status: "OPEN", occurrences: 2, firstSeenAt: date, lastSeenAt: date,
      summary: hidden, detail: hidden, notes: [{ body: hidden }],
      failure: {
        code: "PROVIDER_UNREACHABLE", stage: "fetch-data", reference: "abc123456789",
        explain: "Provider was unavailable", next: "Try later", reportText: hidden,
      },
    }], nextCursor: null,
  });
  f.issue.mockResolvedValue({
    id: "c1234567890123", kind: "AUTOMATION_FAILED", severity: "HIGH",
    status: "OPEN", occurrences: 2, firstSeenAt: date, lastSeenAt: date,
    failureCode: hidden, failureStage: hidden, correlationId: hidden,
    rawReport: hidden,
  });
  f.runs.mockResolvedValue([{
    id: "run-safe-id", ruleKey: "backup", state: "FAILED", startedAt: date,
    finishedAt: date, failureCode: hidden, failureStage: hidden,
    correlationId: hidden, error: hidden, counts: { customer: hidden },
  }]);
  f.manifest.mockResolvedValue({
    verifiedAt: date, photoCounts: {
      copied: 4, unchanged: 5, missing: 0, tombstoned: 1,
      pathname: hidden,
    },
  });
  f.backup.mockResolvedValue({
    latestVerifiedAt: date, lastCompleteAt: date, retentionDays: 30,
    destination: hidden, privatePhotos: "READY", secret: hidden,
  });
  const card = {
    id: "TEST-1", area: "Billing", title: "Tax treatment",
    question: "Which tax setting should apply?", state: "OPEN",
    current: { words: hidden, value: hidden }, recommended: hidden,
    last: { createdAt: date, value: hidden },
    history: [{ id: "record-1", createdAt: date, value: hidden, notes: hidden }],
  };
  f.list.mockResolvedValue([card]);
  f.get.mockResolvedValue(card);
});

describe("MCP read-only diagnostic privacy boundary", () => {
  it("never returns raw customers, logs, decision answers or storage paths across all eight domain reads", async () => {
    const outputs = await Promise.all([
      healthOverview(actor), issuesList(actor, { limit: 20 }),
      issueGet(actor, "c1234567890123"), automationRuns(actor, "backup", 20),
      configurationReadiness(actor), backupStatus(actor),
      decisionsList(actor, 20), decisionGet(actor, "TEST-1"),
    ]);
    for (const item of outputs) expect(JSON.stringify(item)).not.toContain(hidden);
    expect(outputs[5]).toMatchObject({
      storage: "configured",
      photoCopies: { copied: 4, unchanged: 5, missing: 0, tombstoned: 1 },
    });
    expect(outputs[6]).toMatchObject({
      decisions: [{ current: "Recorded privately — open Decisions in the app" }],
    });
  });

  it("requires an active owner/admin actor before serving the domain reads", async () => {
    f.guard.mockRejectedValue(new Error("STAFF_FORBIDDEN"));
    for (const call of [
      () => healthOverview(actor), () => issueGet(actor, "c1234567890123"),
      () => automationRuns(actor, "backup", 1), () => configurationReadiness(actor),
      () => backupStatus(actor),
    ]) await expect(call()).rejects.toThrow("STAFF_FORBIDDEN");
    expect(f.guard).toHaveBeenCalledWith(expect.anything(), actor.userId, ["OWNER", "ADMIN"]);
  });

  it("never echoes a private freeform decision answer", () => {
    expect(safeDecisionWords(hidden)).toBe("Recorded privately — open Decisions in the app");
    expect(safeDecisionWords("Yes")).toBe("Yes");
    expect(safeDecisionWords("$125.00")).toBe("$125.00");
  });
});
