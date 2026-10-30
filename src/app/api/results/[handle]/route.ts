import { rtcAuthorized, rtcError, rtcJson, rtcResultRead } from "@/mcp/rtc-adapter";
import { pageRtcPayload } from "@/domains/agent-control/rtc-results";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  const rawPage = new URL(req.url).searchParams.get("page") ?? "1";
  if (!/^[1-9]\d{0,2}$/.test(rawPage) || Number(rawPage) > 256)
    return rtcError("invalid_args");
  try {
    const saved = await rtcResultRead(auth.ctx, (await params).handle);
    return rtcJson({ ok: true, result: pageRtcPayload(saved.result, Number(rawPage)) });
  } catch { return rtcError("not_found", 404); }
}
