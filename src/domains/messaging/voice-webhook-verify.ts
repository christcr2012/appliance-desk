import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import { communicationsPolicySchema } from "./communications-policy";

const LIMIT = 16_384;
const SID = /^CA[0-9a-fA-F]{32}$/;
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const VOICE_PATHS = new Set([
  "/api/webhooks/twilio/voice",
  "/api/webhooks/twilio/voice/accept",
  "/api/webhooks/twilio/voice/dial-result",
  "/api/webhooks/twilio/voice/status",
  "/api/webhooks/twilio/voice/media",
  "/api/webhooks/twilio/voice/record-complete",
]);

function isolatedTest() {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname === "/appliance_desk_test";
  } catch { return false; }
}

async function boundedText(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type VerifiedVoice = {
  form: URLSearchParams;
  accountId: string;
  accountSid: string;
  callSid: string;
  path: string;
  canonicalOrigin: string;
  policy: ReturnType<typeof communicationsPolicySchema.parse>;
  policyVersion: number;
};

/** Exactly the configured URL is signed; request host/proxy headers are never authority. */
export async function verifyVoiceRequest(
  request: Request,
  path: string,
): Promise<{ verified: VerifiedVoice } | { error: Response }> {
  const fail = (status: number) => ({ error: new Response(null, { status }) });
  if (!((process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") ||
      isolatedTest())) return fail(503);
  const requested = new URL(request.url);
  if (!VOICE_PATHS.has(path) || requested.pathname !== path ||
      (requested.search !== "" &&
        !(path.endsWith("/accept") && requested.search === "?step=decision"))) return fail(400);
  if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !==
      "application/x-www-form-urlencoded") return fail(415);
  const size = request.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > LIMIT)) return fail(413);
  const config = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { communicationsPolicy: true, communicationsPolicyVersion: true },
  });
  const parsed = communicationsPolicySchema.safeParse(config?.communicationsPolicy);
  const origin = parsed.success ? parsed.data.productionWebhookOrigin : null;
  if (!origin || !parsed.success || !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_ACCOUNT_SID) return fail(503);
  const raw = await boundedText(request);
  if (raw === null) return fail(413);
  const form = new URLSearchParams(raw);
  for (const field of ["AccountSid", "CallSid"]) {
    if (form.getAll(field).length !== 1 || !form.get(field)) return fail(400);
  }
  for (const field of ["From", "To", "ParentCallSid", "Digits", "SequenceNumber",
    "CallStatus", "DialCallSid", "DialCallStatus", "DialCallDuration", "DialBridged",
    "RecordingSid", "RecordingStatus", "RecordingDuration"]) {
    if (form.getAll(field).length > 1) return fail(400);
  }
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return fail(403);
  const params: Record<string, string> = {};
  for (const [key, value] of form) params[key] = value;
  const signatureUrl = new URL(path + requested.search, origin).toString();
  if (!twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature,
      signatureUrl, params)) return fail(403);
  const accountSid = form.get("AccountSid")!;
  const callSid = form.get("CallSid")!;
  if (!ACCOUNT_SID.test(accountSid) || !SID.test(callSid) ||
      accountSid !== process.env.TWILIO_ACCOUNT_SID) return fail(403);
  for (const sidField of ["ParentCallSid", "DialCallSid"]) {
    const value = form.get(sidField);
    if (value !== null && !SID.test(value)) return fail(400);
  }
  const account = await prisma.telecomAccount.findFirst({
    where: { provider: "twilio", environment: "PRODUCTION",
      externalAccountId: accountSid },
    select: { id: true },
  });
  if (!account) return fail(403);
  if (path === "/api/webhooks/twilio/voice") {
    const to = form.get("To");
    if (!to || form.getAll("To").length !== 1 ||
        !form.get("From") || form.getAll("From").length !== 1) return fail(400);
    const number = await prisma.businessPhoneNumber.findFirst({
      where: { accountId: account.id, address: to, retiredAt: null },
      select: { id: true },
    });
    if (!number) return fail(403);
  }
  return { verified: {
    form, accountId: account.id, accountSid, callSid, path,
    canonicalOrigin: origin, policy: parsed.data,
    policyVersion: config?.communicationsPolicyVersion ?? 0,
  } };
}

export function voiceXml(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
