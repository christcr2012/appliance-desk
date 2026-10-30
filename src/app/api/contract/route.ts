import { rtcManifest, rtcJson } from "@/mcp/rtc-adapter";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return rtcJson(await rtcManifest()); }
