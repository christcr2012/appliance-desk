/** RTC wire confirmation is additional to (never a replacement for) MCP-5's
 * durable preview, owner approval, claim, readback and idempotency fences.
 * Only the two existing journal tools may be invoked by a writable RTC pass.
 */
export const RTC_JOURNALED_WRITES = [
  "appliance_action_preview",
  "appliance_action_execute",
] as const;

export type RtcWriteDecision =
  | { call: false; result: { done: false; needsConfirmation: true; summary: string } }
  | { call: true; domainArgs: Record<string, unknown> };

export function rtcWriteDecision(name: string, args: Record<string, unknown>,
  authorized: boolean): RtcWriteDecision {
  if (!authorized || !RTC_JOURNALED_WRITES.includes(
    name as (typeof RTC_JOURNALED_WRITES)[number])) throw new Error("refused_by_guard");
  if (args.confirm !== undefined && typeof args.confirm !== "boolean")
    throw new Error("invalid_args");
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean")
    throw new Error("invalid_args");
  const { confirm, dryRun, ...domainArgs } = args;
  if (name === "appliance_action_preview") {
    // A journaled preview is the only permitted side effect of dryRun.
    if (dryRun !== true) return { call: false, result: { done: false,
      needsConfirmation: true, summary: "Request a journal preview with dryRun: true." } };
    return { call: true, domainArgs };
  }
  if (dryRun === true || confirm !== true)
    return { call: false, result: { done: false, needsConfirmation: true,
      summary: "Owner approval and confirm: true are required before executing the original preview." } };
  // These exact fields are checked again in the MCP-5 journal and at dispatch.
  if (typeof domainArgs.previewId !== "string" || domainArgs.previewId.length < 12 ||
      typeof domainArgs.requestKey !== "string" ||
      !/^[A-Za-z0-9_-]{12,128}$/.test(domainArgs.requestKey))
    throw new Error("invalid_args");
  return { call: true, domainArgs };
}
