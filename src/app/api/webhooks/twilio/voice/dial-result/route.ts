import { verifyVoiceRequest, voiceXml } from "@/domains/messaging/voice-webhook-verify";
import { dialResult } from "@/domains/messaging/voice-webhooks";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const auth = await verifyVoiceRequest(request, "/api/webhooks/twilio/voice/dial-result");
  if ("error" in auth) return auth.error;
  try { return voiceXml(await dialResult(auth.verified)); }
  catch (error) {
    console.error("[voice-dial-result] failed", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 500 });
  }
}
