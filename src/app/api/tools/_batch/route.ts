import { rtcAuthorized, rtcError, rtcJson, rtcToolCall } from "@/mcp/rtc-adapter";
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
  const results = [];
  for (const call of calls) {
    if (!call || typeof call !== "object") return rtcError("invalid_args");
    const { name, args } = call as { name?: unknown; args?: unknown };
    if (typeof name !== "string" || !/^appliance_[a-z0-9_]{1,80}$/.test(name) ||
        (args !== undefined && (!args || Array.isArray(args) || typeof args !== "object")))
      return rtcError("invalid_args");
    try { results.push(await rtcToolCall(auth.ctx, name, (args ?? {}) as Record<string, unknown>)); }
    catch (error) { return error instanceof Error && error.message === "invalid_args"
      ? rtcError("invalid_args", 400) : rtcError("refused_by_guard", 403); }
  }
  return rtcJson({ ok: true, result: { results } });
}
