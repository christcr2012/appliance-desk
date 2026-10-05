import { beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreate = vi.fn();
vi.mock("twilio", () => ({
  default: vi.fn(() => ({ messages: { create: (...args: unknown[]) => messagesCreate(...args) } })),
}));

const ORIGINAL_ENV = { ...process.env };

describe("sendSms", () => {
  beforeEach(() => {
    messagesCreate.mockReset().mockResolvedValue({ sid: "SM123" });
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("returns NOT_ATTEMPTED when Twilio is not fully configured", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");
    expect(await sendSms({ to: "+13035550100", body: "hello" })).toEqual({
      sent: false,
      outcome: "NOT_ATTEMPTED",
    });
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("returns NOT_ATTEMPTED when a sending number is still missing", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    delete process.env.TWILIO_PHONE_NUMBER;
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");
    expect(await sendSms({ to: "+13035550100", body: "hello" })).toEqual({
      sent: false,
      outcome: "NOT_ATTEMPTED",
    });
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("returns the Twilio SID when accepted", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    process.env.TWILIO_PHONE_NUMBER = "+13035550199";
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");
    expect(await sendSms({ to: "+13035550100", body: "hello" })).toEqual({
      sent: true,
      outcome: "SENT",
      providerMessageId: "SM123",
    });
    expect(messagesCreate).toHaveBeenCalledWith({
      to: "+13035550100",
      from: "+13035550199",
      body: "hello",
    });
  });

  it("registers the verified status-callback route when the public URL is configured", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    process.env.TWILIO_PHONE_NUMBER = "+13035550199";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test/";
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");
    await sendSms({ to: "+13035550100", body: "hello" });
    expect(messagesCreate).toHaveBeenCalledWith(expect.objectContaining({
      statusCallback: "https://example.test/api/webhooks/twilio",
    }));
  });

  it("classifies clear provider 4xx errors as REJECTED", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    process.env.TWILIO_PHONE_NUMBER = "+13035550199";
    messagesCreate.mockRejectedValue(Object.assign(new Error("bad recipient"), { status: 400 }));
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");
    expect(await sendSms({ to: "+13035550100", body: "hello" })).toEqual({
      sent: false,
      outcome: "REJECTED",
    });
  });

  it("classifies timeout/network/provider-server ambiguity as UNKNOWN", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxx";
    process.env.TWILIO_AUTH_TOKEN = "tokenxxx";
    process.env.TWILIO_PHONE_NUMBER = "+13035550199";
    messagesCreate.mockRejectedValue(new Error("connection reset"));
    vi.resetModules();
    const { sendSms } = await import("@/lib/sms");
    expect(await sendSms({ to: "+13035550100", body: "hello" })).toEqual({
      sent: false,
      outcome: "UNKNOWN",
    });
  });
});
