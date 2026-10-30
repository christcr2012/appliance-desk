import { rtcAuthorized, rtcError, rtcJson, rtcToolCall, rtcToolDescribe } from "@/mcp/rtc-adapter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ name: string }> };
export async function GET(req: Request, { params }: Context) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  const { name } = await params;
  if (!/^appliance_[a-z0-9_]{1,80}$/.test(name)) return rtcError("invalid_args");
  const tool = await rtcToolDescribe(auth.ctx, name);
  return tool ? rtcJson({ ok: true, result: tool }) : rtcError("not_found", 404);
}
export async function POST(req: Request, { params }: Context) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  const { name } = await params;
  if (!/^appliance_[a-z0-9_]{1,80}$/.test(name)) return rtcError("invalid_args");
  if (Number(req.headers.get("content-length") ?? 0) > 65536) return rtcError("invalid_args", 413);
  let raw: unknown;
  try { raw = await req.json(); } catch { return rtcError("invalid_args"); }
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return rtcError("invalid_args");
  const args = raw as Record<string, unknown>;
  if ("confirm" in args || "dryRun" in args || "previewId" in args)
    return rtcError("refused_by_guard", 403); // read-only initial contract: no writes
  try { return rtcJson(await rtcToolCall(auth.ctx, name, args)); }
  catch { return rtcError("refused_by_guard", 403); }
}
