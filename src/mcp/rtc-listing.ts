import type { AgentContext } from "@/domains/agent-control/authorization";
import { rtcToolList } from "@/mcp/rtc-adapter";

export type RtcCatalogOptions = {
  q: string; area: string | null; listing: "catalog" | "compact";
  audience: string | null; page: number; limit: number;
};

/** Listing never elevates permissions: only the MCP read-only registry is returned. */
export async function pageRtcTools(ctx: AgentContext, input: RtcCatalogOptions) {
  const all = await rtcToolList(ctx, input.q, 100);
  const compactSet = new Set([
    "appliance_whoami", "appliance_health_get_overview",
    "appliance_operation_get", "appliance_optimization_get_observations",
  ]);
  const selected = all.filter(tool => {
    if (input.area && tool.area !== input.area) return false;
    if (input.audience && !tool.audience.includes(input.audience)) return false;
    if (input.listing === "compact" && !compactSet.has(tool.name)) return false;
    return true;
  });
  const start = (input.page - 1) * input.limit;
  return {
    tools: selected.slice(start, start + input.limit),
    next: start + input.limit < selected.length ? String(input.page + 1) : null,
  };
}
