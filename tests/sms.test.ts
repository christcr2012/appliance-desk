import { describe, it, expect, vi, beforeEach } from "vitest";

// src/lib/sms.ts — guarded exactly like src/lib/email.ts's sendEmail:
// no-ops safely (never throws, never hangs on a network call) when
// Twilio isn't fully configured, which is the real state right now —
// Chris has an account (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are set in
// Vercel) but can't buy a phone number (TWILIO_PHONE_NUMBER) until his
// LLC's business-texting registration is done.

const messagesCreate = vi.fn();

vi.mock("twilio", () => ({
  default: vi.fn(() => ({ messages: { create: (...args: unknown[]) => messagesCreate(...args) } })),
}));

const ORIGINAL_ENV = { ...process.env };

describe("sendSms", () => {
  beforeEach(() => {
    messagesCreate.mockReset().mockResolvedValue({ sid: "SM123" });
    process.env = { ...ORIGINAL_ENV };
  });

  it("no-ops and returns { sent: false } when Twilio isn't fully configured", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");

    const result = await sendSms({ to: "+13035550100", body: "hello" });

    expect(result).toEqual({ sent: false });
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("no-ops when the account/token are set but there's no phone number yet (today's real state)", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    delete process.env.TWILIO_PHONE_NUMBER;
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");

    const result = await sendSms({ to: "+13035550100", body: "hello" });

    expect(result).toEqual({ sent: false });
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("sends via Twilio once fully configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    process.env.TWILIO_PHONE_NUMBER = "+13035550199";
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");

    const result = await sendSms({ to: "+13035550100", body: "hello" });

    expect(result).toEqual({ sent: true });
    expect(messagesCreate).toHaveBeenCalledWith({
      to: "+13035550100",
      from: "+13035550199",
      body: "hello",
    });
  });

  it("logs and returns { sent: false } rather than throwing when Twilio itself fails", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    process.env.TWILIO_PHONE_NUMBER = "+13035550199";
    messagesCreate.mockRejectedValue(new Error("Twilio is down"));
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");

    const result = await sendSms({ to: "+13035550100", body: "hello" });

    expect(result).toEqual({ sent: false });
  });
});
