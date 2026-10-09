import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";

const { config, receiver, ingest, stop, project } = vi.hoisted(() => ({
  config: vi.fn(), receiver: vi.fn(), ingest: vi.fn(), stop: vi.fn(), project: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessSettings: { findUnique: config },
    businessPhoneNumber: { findFirst: receiver },
  },
}));
vi.mock("@/domains/messaging/inbound-sms", () => ({ ingestVerifiedSms: ingest }));
vi.mock("@/domains/messaging/events", () => ({ processVerifiedTwilioStop: stop }));
vi.mock("@/domains/messaging/consent-commands", () => ({
  projectVerifiedSmsKeyword: project,
  classifyProviderKeyword: (body: string, type: string | null) => {
    if (type) return ["STOP", "START", "HELP"].includes(type) ? type : null;
    const keyword = body.trim().toUpperCase();
    if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) return "STOP";
    return ["START", "UNSTOP", "HELP"].includes(keyword) ? (keyword === "UNSTOP" ? "START" : keyword) : null;
  },
}));

import { POST } from "@/app/api/webhooks/twilio/sms/route";

const saved = {
  CI: process.env.CI,
  DATABASE_URL: process.env.DATABASE_URL,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
};
const sid = "AC" + "a".repeat(32);
const messageSid = "SM" + "b".repeat(32);
const origin = "https://owner.example.test";
const callback = origin + "/api/webhooks/twilio/sms";
const token = "test-only-twilio-signature-token";

function policy(inboundSmsEnabled: boolean) {
  return {
    schemaVersion: 1, manualSmsEnabled: true, inboundSmsEnabled,
    primaryAccountId: "acc", primaryNumberId: "number",
    approvedPolicyVersion: 1, maxSegments: 3,
    supportedCountries: ["US"], productionWebhookOrigin: origin + "/",
  };
}
function form(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    AccountSid: sid, MessageSid: messageSid,
    From: "+13035550199", To: "+13035550200",
    Body: "Hello from a consenting customer", NumMedia: "0",
    ...overrides,
  };
}
function request(data: Record<string, string>, opts: {
  signAs?: string; target?: string; size?: number;
} = {}): Request {
  const encoded = new URLSearchParams(data).toString();
  const signature = twilio.getExpectedTwilioSignature(
    token, opts.signAs ?? callback, data,
  );
  return new Request(
    opts.target ?? "http://untrusted-origin.invalid/api/webhooks/twilio/sms",
    {
      method: "POST", body: encoded,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
        ...(opts.size ? { "content-length": String(opts.size) } : {}),
      },
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CI = "true";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/appliance_desk_test";
  process.env.TWILIO_AUTH_TOKEN = token;
  process.env.TWILIO_ACCOUNT_SID = sid;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  config.mockResolvedValue({
    customerSmsEnabled: true, communicationsPolicy: policy(true),
  });
  receiver.mockResolvedValue({ id: "number" });
  ingest.mockResolvedValue({ duplicate: false, threadId: "thread", messageId: "message" });
  stop.mockResolvedValue({ duplicate: false, customerId: null });
  project.mockResolvedValue({ keyword: "STOP", duplicate: false });
});
afterAll(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("COM-L5A signed inbound webhook safety", () => {
  it("checks the owner canonical origin and returns empty TwiML without an auto reply", async () => {
    const response = await POST(request(form()));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/xml");
    expect(await response.text()).toContain("<Response></Response>");
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      accountSid: sid, messageSid,
      from: "+13035550199", to: "+13035550200",
      mediaCount: 0,
    }));
    expect(stop).not.toHaveBeenCalled();
  });
  it("rejects tampered signature and does not ingest", async () => {
    const response = await POST(request(form(), { signAs: origin + "/another-path" }));
    expect(response.status).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("rejects account/receiver mismatches even with a valid signature", async () => {
    expect((await POST(request(form({
      AccountSid: "AC" + "c".repeat(32),
    })))).status).toBe(403);
    receiver.mockResolvedValueOnce(null);
    expect((await POST(request(form()))).status).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
  it("blocks oversized body and untrusted query before ingest", async () => {
    expect((await POST(request(form(), { size: 100_000 }))).status).toBe(413);
    expect((await POST(request(form(), {
      target: "https://owner.example.test/api/webhooks/twilio/sms?invalid=1",
    }))).status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("preserves STOP suppression when the owner has the inbox switched off", async () => {
    config.mockResolvedValue({
      customerSmsEnabled: false, communicationsPolicy: policy(false),
    });
    const response = await POST(request(form({ Body: "STOP" })));
    expect(response.status).toBe(200);
    expect(stop).toHaveBeenCalledWith({
      eventId: messageSid, from: "+13035550199", keyword: "STOP",
    });
    expect(ingest).not.toHaveBeenCalled();
  });
  it.each(["START", "HELP"])("records signed provider %s while inbound is off, without sending", async (action) => {
    config.mockResolvedValue({ customerSmsEnabled: false, communicationsPolicy: policy(false) });
    const response = await POST(request(form({ Body: action, OptOutType: action })));
    expect(response.status).toBe(200);
    expect(project).toHaveBeenCalledWith(expect.objectContaining({
      accountSid: sid, businessNumberId: "number", messageSid,
      optOutType: action, text: action,
    }));
    expect(stop).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
    expect(await response.text()).toContain("<Response></Response>");
  });

  it("never writes consent evidence from a bad signature", async () => {
    const response = await POST(request(form({ Body: "START", OptOutType: "START" }), {
      signAs: origin + "/wrong",
    }));
    expect(response.status).toBe(403);
    expect(project).not.toHaveBeenCalled();
  });

  it("does not issue a success acknowledgement when durable ingestion fails", async () => {
    ingest.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await POST(request(form()));
    expect(response.status).toBe(500);
  });
});
