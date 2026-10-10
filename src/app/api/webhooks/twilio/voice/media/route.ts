import { verifyVoiceRequest } from "@/domains/messaging/voice-webhook-verify";
import { ingestVoicemailCallback } from "@/domains/messaging/voice-voicemail";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const auth = await verifyVoiceRequest(request, "/api/webhooks/twilio/voice/media");
  if ("error" in auth) return auth.error;
  try {
    await ingestVoicemailCallback(auth.verified);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[voice-media] processing unavailable",
      error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 503 });
  }
}
