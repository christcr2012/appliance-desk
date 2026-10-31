import { rtcPublicManifest } from "@/mcp/rtc-public";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Public manifest: no session, pass lookup, account data or private tool results. */
export async function GET() {
  return Response.json(rtcPublicManifest(), { headers: { "Cache-Control": "no-store" } });
}
