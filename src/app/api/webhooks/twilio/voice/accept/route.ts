import { verifyVoiceRequest, voiceXml } from "@/domains/messaging/voice-webhook-verify";
import { acceptVoiceStep } from "@/domains/messaging/voice-webhooks";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const auth = await verifyVoiceRequest(request, "/api/webhooks/twilio/voice/accept");
  if ("error" in auth) return auth.error;
  const step = new URL(request.url).search === "?step=decision" ? "decision" : "prompt";
  try { return voiceXml(await acceptVoiceStep(auth.verified, step)); }
  catch (error) {
    console.error("[voice-accept] failed", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 500 });
  }
}
