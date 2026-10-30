import { rtcAuthorized, rtcError, rtcJson, rtcResultRead } from "@/mcp/rtc-adapter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  try { return rtcJson(await rtcResultRead(auth.ctx, (await params).handle)); }
  catch { return rtcError("not_found", 404); }
}
