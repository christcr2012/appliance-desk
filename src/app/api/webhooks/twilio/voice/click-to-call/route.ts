import { CLICK_TO_CALL_PATH, verifyVoiceRequest, voiceXml } from "@/domains/messaging/voice-webhook-verify";
import { clickToCallStep } from "@/domains/messaging/voice-webhooks";
export const runtime = "nodejs";

/** Signed callbacks for a call a staff member started from the desk (COM-N2). */
export async function POST(request: Request): Promise<Response> {
  const auth = await verifyVoiceRequest(request, CLICK_TO_CALL_PATH);
  if ("error" in auth) return auth.error;
  const query = new URL(request.url).searchParams;
  const op = query.get("op");
  const rawStep = query.get("step");
  const step = rawStep === "decision" ? "decision" : rawStep === "done" ? "done" : "prompt";
  if (!op) return new Response(null, { status: 400 });
  try { return voiceXml(await clickToCallStep(auth.verified, op, step)); }
  catch (error) {
    console.error("[voice-click-to-call] failed", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 500 });
  }
}
