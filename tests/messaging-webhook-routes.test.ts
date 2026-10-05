import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resendVerify: vi.fn(),
  twilioValidate: vi.fn(),
  resendEvent: vi.fn(),
  twilioStatus: vi.fn(),
  twilioStop: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    webhooks = { verify: (...args: unknown[]) => mocks.resendVerify(...args) };
  },
}));
vi.mock("twilio", () => ({
  default: { validateRequest: (...args: unknown[]) => mocks.twilioValidate(...args) },
}));
vi.mock("@/domains/messaging/events", () => ({
  processVerifiedResendEvent: (...args: unknown[]) => mocks.resendEvent(...args),
  processVerifiedTwilioStatusEvent: (...args: unknown[]) => mocks.twilioStatus(...args),
  processVerifiedTwilioStop: (...args: unknown[]) => mocks.twilioStop(...args),
}));

import { POST as resendPost } from "@/app/api/webhooks/resend/route";
import { POST as twilioPost } from "@/app/api/webhooks/twilio/route";

const env = {
  resend: process.env.RESEND_WEBHOOK_SECRET,
  twilio: process.env.TWILIO_AUTH_TOKEN,
};

function restore(name: "RESEND_WEBHOOK_SECRET" | "TWILIO_AUTH_TOKEN", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("messaging webhook signature boundaries", () => {
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = "resend-test-webhook-secret";
    process.env.TWILIO_AUTH_TOKEN = "twilio-test-auth-token";
    mocks.resendVerify.mockReset();
    mocks.twilioValidate.mockReset();
    mocks.resendEvent.mockReset().mockResolvedValue({ duplicate: false, matched: true });
    mocks.twilioStatus.mockReset().mockResolvedValue({ duplicate: false, matched: true });
    mocks.twilioStop.mockReset().mockResolvedValue({ duplicate: false, customerId: null });
  });

  afterEach(() => {
    restore("RESEND_WEBHOOK_SECRET", env.resend);
    restore("TWILIO_AUTH_TOKEN", env.twilio);
  });

  it("fails closed without the Resend signing secret without reading/processing payload", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const response = await resendPost(new Request("https://example.test/api/webhooks/resend", {
      method: "POST",
      body: "private payload",
    }));
    expect(response.status).toBe(503);
    expect(mocks.resendVerify).not.toHaveBeenCalled();
    expect(mocks.resendEvent).not.toHaveBeenCalled();
  });

  it("rejects a forged Resend signature before domain processing", async () => {
    mocks.resendVerify.mockImplementation(() => { throw new Error("bad signature"); });
    const response = await resendPost(new Request("https://example.test/api/webhooks/resend", {
      method: "POST",
      body: JSON.stringify({ type: "email.delivered" }),
      headers: {
        "svix-id": "evt-test",
        "svix-timestamp": "1",
        "svix-signature": "bad",
      },
    }));
    expect(response.status).toBe(400);
    expect(mocks.resendEvent).not.toHaveBeenCalled();
  });

  it("rejects a forged Twilio signature before domain processing", async () => {
    mocks.twilioValidate.mockReturnValue(false);
    const response = await twilioPost(new Request("https://example.test/api/webhooks/twilio", {
      method: "POST",
      body: new URLSearchParams({ MessageSid: "SM1", MessageStatus: "delivered" }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "bad",
      },
    }));
    expect(response.status).toBe(400);
    expect(mocks.twilioStatus).not.toHaveBeenCalled();
    expect(mocks.twilioStop).not.toHaveBeenCalled();
  });
});
