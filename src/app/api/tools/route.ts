import { rtcAuthorized, rtcError, rtcJson, rtcToolList } from "@/mcp/rtc-adapter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const raw = url.searchParams.get("limit") ?? "10";
  if (q.length > 200 || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 20)
    return rtcError("invalid_args");
  return rtcJson({ ok: true, result: { tools: await rtcToolList(auth.ctx, q, Number(raw)) } });
}
