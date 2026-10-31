import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { rtcToolCall } from "@/mcp/rtc-adapter";

const fakes = vi.hoisted(() => ({
  issues: vi.fn(),
  saved: vi.fn(async () => "rtc_result_synthetic_saved"),
}));
vi.mock("@/mcp/tools/diagnostics", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/mcp/tools/diagnostics")>();
  return { ...original,
    checkMcpActor: vi.fn(async () => undefined), issuesList: fakes.issues };
});
vi.mock("@/domains/agent-control/rtc-results", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domains/agent-control/rtc-results")>();
  return { ...original, storeRtcResult: fakes.saved };
});
const ctx: AgentContext = {
  userId: "synthetic-owner", name: "Synthetic owner", role: "OWNER",
  connectionId: "synthetic-rtc-pass", connectionLabel: "Synthetic pass", scopes: ["ops:read"],
};
const issue = (id: string, detail: string) => ({
  id, kind: "SYSTEM", severity: "INFO", status: "OPEN", count: 1,
  firstSeenUtc: null, lastSeenUtc: null,
  failure: { code: "SYNTHETIC", stage: null, reference: null,
    explanation: detail, nextStep: "Check synthetic fixture only" },
});

describe("MCP-9 large-result handle uses the actual authenticated MCP read handler", () => {
  beforeEach(() => {
    fakes.issues.mockReset();
    fakes.saved.mockClear();
    fakes.issues.mockImplementation(async (_ctx: unknown, options: { cursor?: string }) =>
      options.cursor ? { issues: [issue("synthetic-second", "B".repeat(5100))], nextCursor: null } :
        { issues: [issue("synthetic-first", "A".repeat(5100))], nextCursor: "synthetic-first" });
  });
  it("summary stays one page, full read fetches both guarded pages and stores an owned handle", async () => {
    const summary = await rtcToolCall(ctx, "appliance_health_list_issues", { detail: "summary" });
    expect(summary.ok).toBe(true);
    expect("handle" in summary).toBe(false);
    expect(fakes.issues).toHaveBeenCalledTimes(1);
    const full = await rtcToolCall(ctx, "appliance_health_list_issues",
      { detail: "full", fields: "issues" });
    expect(full.ok).toBe(true);
    expect(full).toMatchObject({
      handle: "rtc_result_synthetic_saved",
      result: { count: 2 },
    });
    expect(fakes.issues).toHaveBeenCalledTimes(3);
    const savedPayload = fakes.saved.mock.calls[0]?.[1] as
      { issues: { id: string }[] } | undefined;
    expect(savedPayload?.issues.map(row => row.id))
      .toEqual(["synthetic-first", "synthetic-second"]);
    expect(JSON.stringify(savedPayload)).not.toContain("rtc_pass_");
  });
});
