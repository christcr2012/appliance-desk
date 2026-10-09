import { verifyVoiceRequest } from "@/domains/messaging/voice-webhook-verify";
import { voiceStatus } from "@/domains/messaging/voice-webhooks";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const auth = await verifyVoiceRequest(request, "/api/webhooks/twilio/voice/status");
  if ("error" in auth) return auth.error;
  try { await voiceStatus(auth.verified); return new Response(null, { status: 204 }); }
  catch (error) {
    console.error("[voice-status] failed", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 500 });
  }
}
