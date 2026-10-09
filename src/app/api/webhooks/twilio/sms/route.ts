import twilio from "twilio";

// Twilio validation, authenticated encryption and PostgreSQL require Node.js.
export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";
import { communicationsPolicySchema } from "@/domains/messaging/communications-policy";
import { ingestVerifiedSms } from "@/domains/messaging/inbound-sms";
import { processVerifiedTwilioStop } from "@/domains/messaging/events";

const MAX_BODY_BYTES = 16_384;
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function xml() {
  return new Response(RESPONSE, {
    status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
function fail(status: number) {
  return new Response(null, { status });
}
function isIsolatedTestDatabase() {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname === "/appliance_desk_test";
  } catch { return false; }
}

/** No unbounded request.text(): cap the original signed bytes while streaming. */
async function readLimitedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let length = 0;
  const buffers: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    buffers.push(value);
  }
  return Buffer.concat(buffers).toString("utf8");
}

/**
 * Only accepts a signed production webhook at the owner's canonical HTTPS
 * origin; never build the validation URL from untrusted Host headers.
 * Twilio signature authenticates transport, not authorization or identity.
 */
export async function POST(request: Request): Promise<Response> {
  if (!((process.env.VERCEL === "1" &&
      process.env.VERCEL_ENV === "production") || isIsolatedTestDatabase())) {
    return fail(503);
  }
  const config = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { customerSmsEnabled: true, communicationsPolicy: true },
  });
  const policy = communicationsPolicySchema.safeParse(config?.communicationsPolicy);
  const origin = policy.success ? policy.data.productionWebhookOrigin : null;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!origin || !token || !process.env.TWILIO_ACCOUNT_SID ||
      (request.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded") {
    return fail(503);
  }
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/api/webhooks/twilio/sms" || requestUrl.search) {
    return fail(400);
  }
  const declaredSize = request.headers.get("content-length");
  if (declaredSize && (Number(declaredSize) > MAX_BODY_BYTES || Number(declaredSize) < 0)) {
    return fail(413);
  }
  const raw = await readLimitedBody(request);
  if (raw === null) return fail(413);
  const form = new URLSearchParams(raw);
  const required = ["AccountSid", "MessageSid", "From", "To"];
  for (const name of required) {
    if (form.getAll(name).length !== 1 || !form.get(name)?.trim()) return fail(400);
  }
  for (const name of ["Body", "NumMedia", "OptOutType"]) {
    if (form.getAll(name).length > 1) return fail(400);
  }
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return fail(403);
  const params: Record<string, string> = {};
  for (const [key, value] of form) params[key] = value;
  const expectedUrl = new URL("/api/webhooks/twilio/sms", origin).toString();
  if (!twilio.validateRequest(token, signature, expectedUrl, params)) {
    return fail(403);
  }
  const accountSid = form.get("AccountSid")!;
  const messageSid = form.get("MessageSid")!;
  const from = form.get("From")!;
  const to = form.get("To")!;
  if (accountSid !== process.env.TWILIO_ACCOUNT_SID ||
      !/^AC[0-9a-fA-F]{32}$/.test(accountSid) ||
      !/^(SM|MM)[0-9a-fA-F]{32}$/.test(messageSid)) return fail(403);
  const registeredNumber = await prisma.businessPhoneNumber.findFirst({
    where: { account: { externalAccountId: accountSid, environment: "PRODUCTION",
      provider: "twilio" }, address: to, retiredAt: null,
      registrationStatus: "APPROVED", verifiedAt: { not: null } },
    select: { id: true },
  });
  if (!registeredNumber) return fail(403);
  const body = form.get("Body") ?? "";
  const numMedia = Number(form.get("NumMedia") ?? "0");
  const stopKeyword = body.trim().toUpperCase();
  const isStop = form.get("OptOutType") === "STOP" || STOP.has(stopKeyword);

  try {
    // Legal/privacy STOP suppression must work even while the inbox gate is off.
    // The legacy verified handler atomically persists suppression/evidence.
    if (isStop) {
      await processVerifiedTwilioStop({
        eventId: messageSid, from, keyword: stopKeyword || "STOP",
      });
    }
    if (config?.customerSmsEnabled !== true || !policy.success ||
        policy.data.inboundSmsEnabled !== true) {
      return isStop ? xml() : fail(503);
    }
    await ingestVerifiedSms({
      accountSid, messageSid, from, to, text: body,
      mediaCount: numMedia,
    });
    return xml();
  } catch (error) {
    // Never echo customer data or Twilio payload into logs or responses.
    console.error("[communications-inbound] verified event failed",
      error instanceof Error ? error.name : "unknown");
    return fail(500); // Keep provider retry enabled until durably stored.
  }
}
