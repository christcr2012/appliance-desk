import { rtcAuthorized, rtcError, rtcJson } from "@/mcp/rtc-adapter";
import { pageRtcTools } from "@/mcp/rtc-listing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const rawLimit = params.get("limit") ?? "10";
  const rawPage = params.get("page") ?? "1";
  const listing = params.get("listing") ?? "catalog";
  const area = params.get("area");
  const audience = params.get("audience");
  if (q.length > 200 || !/^[1-9]\d{0,2}$/.test(rawLimit) ||
      !/^[1-9]\d{0,2}$/.test(rawPage) ||
      Number(rawLimit) > 100 || Number(rawPage) > 100 ||
      !["catalog", "compact"].includes(listing) ||
      (area !== null && !/^[a-z][a-z0-9_]{0,30}$/.test(area)) ||
      (audience !== null && !["owner", "operator"].includes(audience)))
    return rtcError("invalid_args");
  return rtcJson({ ok: true, result: await pageRtcTools(auth.ctx, {
    q, area, audience, listing: listing as "catalog" | "compact",
    page: Number(rawPage), limit: Number(rawLimit),
  }) });
}
