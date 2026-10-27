import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { AUTOMATION_RULES, missingEnvFor, validateLateGraceMinutes } from "@/domains/automation/health";
import { HEALTH_PRESENTATION, HEALTH_STATES } from "@/domains/automation/health-states";
import { computeHealthState, firstDueAt, lastDueAt, nextDueAt, parseCron, type HealthStateInput } from "@/domains/automation/schedule";
import {
  AutomationFailure, CORRELATION_ID, FAILURE_CODES, classifyFailure, failureExplanation, newCorrelationId,
} from "@/domains/automation/failures";
import { safeError } from "@/domains/automation/runs";
import { renderSystemIssue } from "@/domains/system-issues/render";
import { formatBusinessTime } from "@/lib/business-date";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const at = (iso: string) => new Date(iso);
const backup = AUTOMATION_RULES.find((rule) => rule.ruleKey === "backup")!;
const books = AUTOMATION_RULES.find((rule) => rule.ruleKey === "books-nightly")!;
const base = (over: Partial<HealthStateInput>): HealthStateInput => ({
  rule: { cron: "0 9 * * *", addedOn: "2026-01-01" }, now: at("2026-10-20T18:00:00Z"), graceMinutes: 120,
  paused: false, missingEnv: [], latest: null, lastSuccessStartedAt: null, ...over,
});
const success = (iso: string) => ({ latest: { state: "SUCCEEDED" as const, startedAt: at(iso), budgetSeconds: 60 }, lastSuccessStartedAt: at(iso) });

describe("MCP-1 one state list (spec 1)", () => {
  it("gives every state a label, a deliberate colour and a meaning", () => {
    expect(Object.keys(HEALTH_PRESENTATION).sort()).toEqual([...HEALTH_STATES].sort());
    for (const state of HEALTH_STATES) {
      const look = HEALTH_PRESENTATION[state];
      expect(look.label.trim().length).toBeGreaterThan(2);
      expect(look.meaning.trim().length).toBeGreaterThan(10);
      expect(["good", "attention", "danger", "info", "neutral"]).toContain(look.tone);
    }
    expect(HEALTH_PRESENTATION.healthy.tone).toBe("good");
    expect(HEALTH_PRESENTATION.failing.tone).toBe("danger");
    expect(new Set(HEALTH_STATES.map((s) => HEALTH_PRESENTATION[s].label)).size).toBe(HEALTH_STATES.length);
  });
});

describe("MCP-1 schedules match vercel.json (spec 2)", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  it("every cron path has a rule with the identical UTC schedule, and every rule names a real cron", () => {
    for (const cron of vercel.crons) {
      parseCron(cron.schedule); // fails on any unsupported form
      const rules = AUTOMATION_RULES.filter((rule) => rule.cronPath === cron.path);
      expect(rules.length, cron.path).toBeGreaterThan(0);
      for (const rule of rules) expect(rule.cron, rule.ruleKey).toBe(cron.schedule);
    }
    for (const rule of AUTOMATION_RULES) {
      const cron = vercel.crons.find((item) => item.path === rule.cronPath);
      expect(cron, rule.ruleKey).toBeDefined();
      expect(rule.cron).toBe(cron!.schedule);
      expect(firstDueAt(rule).getTime()).toBeGreaterThan(0);
    }
    expect(backup.cron).toBe("0 9 * * *");
    expect(books.cron).toBe("40 9 * * *");
  });
  it("rejects cron forms the app does not support", () => {
    for (const bad of ["*/5 * * * *", "0 9 * 1 *", "0 9 1 * 1", "0 9 * * 1-5", "0 24 * * *", "0 9 * *"]) {
      expect(() => parseCron(bad), bad).toThrow(/Unsupported/);
    }
  });
});

describe("MCP-1 lastDueAt (spec 2)", () => {
  it("computes in UTC; the Colorado time moves with daylight saving", () => {
    expect(lastDueAt(backup, at("2026-01-15T12:00:00Z")).toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(formatBusinessTime(lastDueAt(backup, at("2026-01-15T12:00:00Z")))).toMatch(/^2:00\s?AM/);
    expect(lastDueAt(backup, at("2026-07-15T12:00:00Z")).toISOString()).toBe("2026-07-15T09:00:00.000Z");
    expect(formatBusinessTime(lastDueAt(backup, at("2026-07-15T12:00:00Z")))).toMatch(/^3:00\s?AM/);
    expect(lastDueAt(backup, at("2026-01-15T08:59:59Z")).toISOString()).toBe("2026-01-14T09:00:00.000Z");
  });
  it("is unchanged by the DST change days (8 Mar and 1 Nov 2026)", () => {
    expect(lastDueAt(backup, at("2026-03-08T10:00:00Z")).toISOString()).toBe("2026-03-08T09:00:00.000Z");
    expect(formatBusinessTime(lastDueAt(backup, at("2026-03-08T10:00:00Z")))).toMatch(/^3:00\s?AM/);
    expect(lastDueAt(backup, at("2026-03-07T10:00:00Z")).toISOString()).toBe("2026-03-07T09:00:00.000Z");
    expect(formatBusinessTime(lastDueAt(backup, at("2026-03-07T10:00:00Z")))).toMatch(/^2:00\s?AM/);
    expect(lastDueAt(backup, at("2026-11-01T10:00:00Z")).toISOString()).toBe("2026-11-01T09:00:00.000Z");
    expect(formatBusinessTime(lastDueAt(backup, at("2026-11-01T10:00:00Z")))).toMatch(/^2:00\s?AM/);
  });
  it("counts a run at exactly 09:40 UTC for books-nightly", () => {
    expect(lastDueAt(books, at("2026-10-20T09:40:00Z")).toISOString()).toBe("2026-10-20T09:40:00.000Z");
    expect(lastDueAt(books, at("2026-10-20T09:39:59Z")).toISOString()).toBe("2026-10-19T09:40:00.000Z");
    const run = computeHealthState(base({ rule: { cron: books.cron, addedOn: "2026-01-01" }, now: at("2026-10-20T12:00:00Z"), ...success("2026-10-20T09:40:00Z") }));
    expect(run.state).toBe("healthy");
  });
  it("handles a weekly Monday rule on a Sunday and a monthly rule on the 1st", () => {
    // 2026-10-25 is a Sunday; the last Monday 08:00 UTC slot was 2026-10-19.
    expect(lastDueAt("0 8 * * 1", at("2026-10-25T20:00:00Z")).toISOString()).toBe("2026-10-19T08:00:00.000Z");
    expect(nextDueAt("0 8 * * 1", at("2026-10-25T20:00:00Z")).toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(lastDueAt("30 6 1 * *", at("2026-11-01T07:00:00Z")).toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(lastDueAt("30 6 1 * *", at("2026-11-01T06:00:00Z")).toISOString()).toBe("2026-10-01T06:30:00.000Z");
  });
});

describe("MCP-1 state rule (spec 2)", () => {
  it("first match wins: paused, then setup, then the run evidence", () => {
    expect(computeHealthState(base({ paused: true, missingEnv: ["CRON_SECRET"] })).state).toBe("paused");
    expect(computeHealthState(base({ missingEnv: ["CRON_SECRET"], ...success("2026-10-20T09:00:00Z") })).state).toBe("unconfigured");
  });
  it("an old success is late, not Working", () => {
    expect(computeHealthState(base(success("2026-10-10T09:00:00Z"))).state).toBe("late");
    expect(computeHealthState(base(success("2026-10-20T09:00:30Z"))).state).toBe("healthy");
  });
  it("waits for the grace period before calling a missed slot late", () => {
    const yesterday = success("2026-10-19T09:00:00Z");
    expect(computeHealthState(base({ ...yesterday, now: at("2026-10-20T10:59:00Z") })).state).toBe("healthy");
    expect(computeHealthState(base({ ...yesterday, now: at("2026-10-20T11:01:00Z") })).state).toBe("late");
    expect(computeHealthState(base({ ...yesterday, now: at("2026-10-20T09:30:00Z"), graceMinutes: 15 })).state).toBe("late");
  });
  it("a success that started up to five minutes early counts for its slot", () => {
    expect(computeHealthState(base(success("2026-10-20T08:56:00Z"))).state).toBe("healthy");
    expect(computeHealthState(base(success("2026-10-20T08:54:00Z"))).state).toBe("late");
  });
  it("a recent failure is Failed even when an older success exists", () => {
    const state = computeHealthState(base({
      latest: { state: "FAILED", startedAt: at("2026-10-20T09:00:00Z"), budgetSeconds: 60 },
      lastSuccessStartedAt: at("2026-10-19T09:00:00Z"),
    })).state;
    expect(state).toBe("failing");
  });
  it("running within budget is Running now; past budget or UNKNOWN is Not sure", () => {
    const running = { state: "RUNNING" as const, startedAt: at("2026-10-20T17:59:00Z"), budgetSeconds: 300 };
    expect(computeHealthState(base({ latest: running })).state).toBe("running");
    expect(computeHealthState(base({ latest: { ...running, startedAt: at("2026-10-20T17:00:00Z") } })).state).toBe("unknown");
    expect(computeHealthState(base({ latest: { ...running, state: "UNKNOWN" } })).state).toBe("unknown");
  });
  it("a new rule shows Hasn't run yet until its first due time plus grace, then Late", () => {
    const rule = { cron: "0 9 * * *", addedOn: "2026-10-20" };
    expect(computeHealthState(base({ rule, now: at("2026-10-20T10:59:00Z") })).state).toBe("never-ran");
    expect(computeHealthState(base({ rule, now: at("2026-10-20T11:01:00Z") })).state).toBe("late");
    expect(computeHealthState(base({ rule, now: at("2026-10-19T20:00:00Z") })).state).toBe("never-ran");
  });
  it("ignores a run whose start is more than five minutes in the future (clock skew)", () => {
    const future = computeHealthState(base({
      latest: { state: "SUCCEEDED", startedAt: at("2026-10-20T18:06:00Z"), budgetSeconds: 60 },
      lastSuccessStartedAt: at("2026-10-20T18:06:00Z"),
    }));
    expect(future.clockSkew).toBe(true);
    expect(future.state).toBe("late");
    const nearFuture = computeHealthState(base({ ...success("2026-10-20T18:04:00Z") }));
    expect(nearFuture.clockSkew).toBe(false);
    expect(nearFuture.state).toBe("healthy");
    const skewedFailure = computeHealthState(base({
      latest: { state: "FAILED", startedAt: at("2026-10-21T09:00:00Z"), budgetSeconds: 60 },
      lastSuccessStartedAt: at("2026-10-20T09:00:00Z"),
    }));
    expect(skewedFailure).toMatchObject({ state: "healthy", clockSkew: true });
  });
  it("an owner-skipped slot counts as handled", () => {
    expect(computeHealthState(base({
      latest: { state: "SKIPPED", startedAt: at("2026-10-20T09:00:00Z"), budgetSeconds: 60 },
    })).state).toBe("healthy");
  });
});

describe("MCP-1 setup names and the grace setting", () => {
  it("reports only names, and an _ENABLED switch counts only when exactly true", () => {
    const telecom = AUTOMATION_RULES.find((rule) => rule.ruleKey === "telecom-sync")!;
    expect(missingEnvFor(telecom, { CRON_SECRET: "x", TELECOM_SYNC_ENABLED: "false" })).toEqual(["TELECOM_SYNC_ENABLED"]);
    expect(missingEnvFor(telecom, { CRON_SECRET: "x", TELECOM_SYNC_ENABLED: "true" })).toEqual([]);
    expect(missingEnvFor(telecom, {})).toEqual(["CRON_SECRET", "TELECOM_SYNC_ENABLED"]);
  });
  it("accepts 15 minutes to 24 hours in whole minutes", () => {
    expect(validateLateGraceMinutes(120)).toBe(120);
    for (const bad of [14, 1441, 30.5, Number.NaN]) expect(() => validateLateGraceMinutes(bad)).toThrow(/15 minutes/);
  });
});

describe("MCP-1 typed failures (spec 4)", () => {
  it("has a plain explanation and next step for every required code", () => {
    for (const code of ["CONFIG_MISSING", "PROVIDER_UNREACHABLE", "PROVIDER_REFUSED", "TIMEOUT", "DATABASE_BUSY",
      "DATA_PROBLEM", "BACKUP_CAPTURE", "BACKUP_UPLOAD", "BACKUP_READBACK", "BACKUP_PRUNE", "MEDIA_STORE_NOT_READY",
      "MEDIA_COPY", "UNCLASSIFIED"]) {
      const item = (FAILURE_CODES as Record<string, { explain: string; next: string }>)[code];
      expect(item, code).toBeDefined();
      expect(item!.explain.length).toBeGreaterThan(20);
      expect(item!.next.length).toBeGreaterThan(20);
    }
    expect(failureExplanation(null).explain).toMatch(/^Not recorded/);
    expect(failureExplanation("SOMETHING_ELSE").code).toBeNull();
  });
  it("classifies by class or code, never by guessing from the message", () => {
    expect(classifyFailure(new AutomationFailure("BACKUP_UPLOAD", "upload"))).toEqual({ code: "BACKUP_UPLOAD", stage: "upload" });
    expect(classifyFailure(new Prisma.PrismaClientKnownRequestError("busy", { code: "P2024", clientVersion: "x" })).code).toBe("DATABASE_BUSY");
    expect(classifyFailure(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "x" })).code).toBe("DATABASE_BUSY");
    expect(classifyFailure(new Prisma.PrismaClientKnownRequestError("dupe", { code: "P2002", clientVersion: "x" })).code).toBe("DATA_PROBLEM");
    expect(classifyFailure(Object.assign(new Error("x"), { name: "AbortError" })).code).toBe("TIMEOUT");
    class StripeConnectionError extends Error {}
    class StripeAuthenticationError extends Error {}
    class BlobAccessError extends Error {}
    expect(classifyFailure(new StripeConnectionError("x")).code).toBe("PROVIDER_UNREACHABLE");
    expect(classifyFailure(new StripeAuthenticationError("x")).code).toBe("PROVIDER_REFUSED");
    expect(classifyFailure(new BlobAccessError("x")).code).toBe("PROVIDER_REFUSED");
    expect(classifyFailure(Object.assign(new Error("x"), { code: "ECONNRESET" })).code).toBe("PROVIDER_UNREACHABLE");
    expect(classifyFailure(new Error("timeout talking to Stripe")).code).toBe("UNCLASSIFIED");
    expect(classifyFailure("a string").code).toBe("UNCLASSIFIED");
    expect(() => new AutomationFailure("TIMEOUT", "Bad Stage!")).toThrow(/stage/);
  });
  it("makes meaningless references", () => {
    const a = newCorrelationId();
    expect(a).toMatch(CORRELATION_ID);
    expect(newCorrelationId()).not.toBe(a);
  });
  it("legacy safeError also strips phone numbers and JSON address values", () => {
    const secret = ["sk", "live", "canary" + Math.random().toString(36).slice(2).padEnd(18, "q")].join("_");
    const raw = `failed {"address":"1234 Main Street, Greeley","name":"x"} call (970) 555-0142 or +1 970 555 0142 ${secret}`;
    const cleaned = safeError(new Error(raw));
    for (const leaked of ["1234 Main Street", "555-0142", "555 0142", secret]) expect(cleaned).not.toContain(leaked);
  });
  it("an issue carries only the code's fixed wording and a valid reference", () => {
    const ref = newCorrelationId();
    const issue = renderSystemIssue({ kind: "AUTOMATION_FAILED", ruleKey: "backup", runId: "run1",
      startedAt: at("2026-10-20T09:00:00Z"), errorName: "Error", failure: { code: "TIMEOUT", stage: "work", correlationId: ref } });
    expect(issue.failure).toEqual({ code: "TIMEOUT", stage: "work", correlationId: ref });
    expect(issue.detail).toContain(FAILURE_CODES.TIMEOUT.explain);
    expect(() => renderSystemIssue({ kind: "AUTOMATION_FAILED", ruleKey: "backup", runId: "run1",
      startedAt: at("2026-10-20T09:00:00Z"), errorName: "Error", failure: { code: "TIMEOUT", stage: "work", correlationId: "Jane Smith" } })).toThrow();
    expect(() => renderSystemIssue({ kind: "AUTOMATION_FAILED", ruleKey: "backup", runId: "run1",
      startedAt: at("2026-10-20T09:00:00Z"), errorName: "Error", failure: { code: "made up", stage: "work", correlationId: ref } })).toThrow();
    const late = renderSystemIssue({ kind: "AUTOMATION_STALE", ruleKey: "backup", lastSuccessAt: null,
      dueAt: at("2026-10-20T09:00:00Z"), graceMinutes: 120 });
    expect(late.fingerprint).toBe("automation-stale:backup");
  });
});

describe("automation rule registry", () => {
  it("tracks the real post-D billing reconciliation passes", () => {
    const keys = AUTOMATION_RULES.map((rule) => rule.ruleKey);
    expect(keys.filter((key) => key.startsWith("billing-reconcile:")).sort()).toEqual([
      "billing-reconcile:provider-ops",
      "billing-reconcile:bank-in-flight",
      "billing-reconcile:job-handoffs",
      "billing-reconcile:invoice-artifacts",
      "billing-reconcile:message-deliveries",
      "billing-reconcile:retail-delivery-fees",
      "billing-reconcile:retail-delivery-fee-charges",
    ].sort());
    expect(keys).not.toContain("billing-reconcile:subscription-ends");
  });

  it("tracks every current renewal lifecycle pass once", () => {
    const keys = AUTOMATION_RULES.map((rule) => rule.ruleKey);
    expect(keys.filter((key) => key.startsWith("start-renewals:"))).toEqual([
      "start-renewals:auto-renewals",
      "start-renewals:annual-reminders",
      "start-renewals:pending-notices",
      "start-renewals:billing-extensions",
      "start-renewals:due-terminations",
      "start-renewals:close-returns",
      "start-renewals:start-due-renewals",
    ]);
  });

  it("tracks the Batch T rate-change job", () => {
    expect(AUTOMATION_RULES.map((rule) => rule.ruleKey)).toContain(
      "tax-rate-changes",
    );
  });

  it("tracks the Batch T address re-check", () => {
    expect(AUTOMATION_RULES.map((rule) => rule.ruleKey)).toContain(
      "tax-address-recheck",
    );
  });

  it("has one unique key and a plain explanation for every displayed rule", () => {
    const keys = AUTOMATION_RULES.map((rule) => rule.ruleKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const rule of AUTOMATION_RULES) {
      expect(rule.label.trim().length).toBeGreaterThan(0);
      expect(rule.explanation.trim().length).toBeGreaterThan(20);
      expect(rule.resolutionHref).toContain("/desk/automations#");
    }
  });
});
