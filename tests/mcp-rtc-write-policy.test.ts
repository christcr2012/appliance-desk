import { describe, expect, it } from "vitest";
import { RTC_JOURNALED_WRITES, rtcWriteDecision } from "@/mcp/rtc-write-policy";

describe("RTC writes cannot bypass the existing MCP-5 owner-approval journal", () => {
  it("exposes only preview and execute; no unjournaled direct mutations", () => {
    expect(RTC_JOURNALED_WRITES).toEqual([
      "appliance_action_preview", "appliance_action_execute",
    ]);
    for (const name of ["appliance_feedback_reply", "appliance_optimization_create_proposal",
      "appliance_repair_create_case"]) {
      expect(() => rtcWriteDecision(name, {}, true)).toThrow("refused_by_guard");
    }
  });
  it("read-only passes cannot initiate even a preview or execute operation", () => {
    for (const name of RTC_JOURNALED_WRITES)
      expect(() => rtcWriteDecision(name, { dryRun: true }, false)).toThrow("refused_by_guard");
  });
  it("preview requires explicit dryRun and strips wire arguments from MCP payload", () => {
    const args = { action: "PAUSE_AUTOMATION", args: { ruleKey: "test-rule" },
      requestKey: "synthetic-request-01", dryRun: true, confirm: true };
    expect(rtcWriteDecision("appliance_action_preview", args, true)).toEqual({
      call: true, domainArgs: { action: args.action, args: args.args, requestKey: args.requestKey },
    });
    expect(rtcWriteDecision("appliance_action_preview", { action: args.action }, true))
      .toMatchObject({ call: false, result: { done: false, needsConfirmation: true } });
  });
  it("execution needs wire confirm, a preview id and its idempotency key", () => {
    const input = { previewId: "synthetic-preview-id-01", requestKey: "synthetic-request-01" };
    expect(rtcWriteDecision("appliance_action_execute", input, true)).toMatchObject({
      call: false, result: { done: false, needsConfirmation: true },
    });
    expect(rtcWriteDecision("appliance_action_execute", { ...input, dryRun: true, confirm: true }, true))
      .toMatchObject({ call: false, result: { done: false } });
    expect(rtcWriteDecision("appliance_action_execute", { ...input, confirm: true }, true))
      .toEqual({ call: true, domainArgs: input });
    expect(() => rtcWriteDecision("appliance_action_execute", { confirm: true }, true))
      .toThrow("invalid_args");
    expect(() => rtcWriteDecision("appliance_action_execute", { ...input, confirm: "true" }, true))
      .toThrow("invalid_args");
  });
});
