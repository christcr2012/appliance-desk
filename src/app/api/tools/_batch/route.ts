import { rtcAuthorized, rtcError, rtcJson, rtcToolCall, rtcTools } from "@/mcp/rtc-adapter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  if (Number(req.headers.get("content-length") ?? 0) > 65536) return rtcError("invalid_args", 413);
  let raw: unknown;
  try { raw = await req.json(); } catch { return rtcError("invalid_args"); }
  const calls = (raw as { calls?: unknown })?.calls;
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > 10)
    return rtcError("invalid_args");
  const validated: { name: string; args: Record<string, unknown> }[] = [];
  for (const call of calls) {
    if (!call || typeof call !== "object") return rtcError("invalid_args");
    const { name, args } = call as { name?: unknown; args?: unknown };
    if (typeof name !== "string" || !/^appliance_[a-z0-9_]{1,80}$/.test(name) ||
        (args !== undefined && (!args || Array.isArray(args) || typeof args !== "object")))
      return rtcError("invalid_args");
    validated.push({ name, args: (args ?? {}) as Record<string, unknown> });
  }
  // RTC 1 batches are strictly read-only, even for internal full passes.
  // Validate the entire batch before invoking a single MCP handler: a
  // journal preview is a write, even if it returns needsConfirmation.
  const reads = new Set((await rtcTools(auth.ctx))
    .filter(tool => tool.annotations?.readOnlyHint === true)
    .map(tool => tool.name));
  if (validated.some(call => !reads.has(call.name)))
    return rtcError("refused_by_guard", 403);
  const results = [];
  for (const call of validated) {
    try { results.push(await rtcToolCall(auth.ctx, call.name, call.args)); }
    catch (error) { return error instanceof Error && error.message === "invalid_args"
      ? rtcError("invalid_args", 400) : rtcError("refused_by_guard", 403); }
  }
  return rtcJson({ ok: true, result: { results } });
}
