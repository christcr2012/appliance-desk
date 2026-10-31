import { rtcAuthorized, rtcJson } from "@/mcp/rtc-adapter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = await rtcAuthorized(req);
  if ("response" in auth) return auth.response;
  const ctx = auth.ctx;
  return rtcJson({ ok: true, result: {
    name: ctx.name, role: ctx.role, scopes: ctx.scopes,
    connectionLabel: ctx.connectionLabel, mode: "read_only",
  } });
}
