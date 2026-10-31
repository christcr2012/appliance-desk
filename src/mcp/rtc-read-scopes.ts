import type { AgentContext } from "@/domains/agent-control/authorization";
import type { McpScope } from "@/mcp/scopes";

/** Read permissions are intentionally separate from the catalog's display areas.
 * Underlying MCP handlers still enforce these grants on every call.
 */
export function rtcReadScopesForArea(area: string, decisionsRead: boolean): McpScope[] {
  if (area === "all") {
    return ["ops:read", "feedback:triage", ...(decisionsRead ? ["decisions:read" as const] : [])];
  }
  if (area === "decisions") return ["decisions:read"];
  if (area === "feedback") return ["feedback:triage"];
  if (["health", "automation", "configuration", "backup", "repair", "optimization"].includes(area))
    return ["ops:read"];
  throw new Error("INVALID_RTC_PASS_AREAS");
}

/** A pass cannot discover read tools outside the scope of its MCP authority. */
export function rtcCanDiscoverRead(ctx: AgentContext, name: string): boolean {
  if (name === "appliance_whoami") return true;
  const required: McpScope =
    name.startsWith("appliance_decisions_") ? "decisions:read" :
    name.startsWith("appliance_feedback_") ? "feedback:triage" : "ops:read";
  return ctx.scopes.includes(required);
}
