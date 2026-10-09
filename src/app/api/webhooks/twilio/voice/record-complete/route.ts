import { verifyVoiceRequest, voiceXml } from "@/domains/messaging/voice-webhook-verify";
import { completeVoicemailStep } from "@/domains/messaging/voice-voicemail";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const auth = await verifyVoiceRequest(request, "/api/webhooks/twilio/voice/record-complete");
  if ("error" in auth) return auth.error;
  try { return voiceXml(await completeVoicemailStep(auth.verified)); }
  catch (error) {
    console.error("[voice-record-complete] failed",
      error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 500 });
  }
}
