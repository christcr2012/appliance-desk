import { describe, expect, it, afterEach } from "vitest";
import { basicLookupProvesUsDestination, classifyTwilioSubmitError, makeTwilioSmsProvider } from "@/lib/communications/providers/twilio-sms";

const previous = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV };
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("COM-L4B provider without live API calls", () => {
  it("categorizes ambiguous timeouts, 429, 5xx and transport errors as UNKNOWN", () => {
    for (const status of [408, 429, 500, 503]) {
      expect(classifyTwilioSubmitError({ status })).toEqual({ kind: "UNKNOWN" });
    }
    expect(classifyTwilioSubmitError(new Error("socket closed"))).toEqual({ kind: "UNKNOWN" });
  });

  it("treats definitive Twilio 4xx responses as rejected without retrying", () => {
    expect(classifyTwilioSubmitError({ status: 400, code: 21608 }))
      .toEqual({ kind: "REJECTED", code: "21608" });
    expect(classifyTwilioSubmitError({ status: 403 })).toEqual({
      kind: "REJECTED", code: "TWILIO_REJECTED",
    });
  });

  it("requires a verified US Basic Lookup result, not just country code +1", () => {
    const value = "+13035550137";
    expect(basicLookupProvesUsDestination(value, {
      countryCode: "US", phoneNumber: value, valid: true,
    })).toBe(true);
    for (const observation of [
      { countryCode: "CA", phoneNumber: value, valid: true },
      { countryCode: "US", phoneNumber: value, valid: false },
      { countryCode: "US", phoneNumber: "+13035550138", valid: true },
      { valid: true },
    ]) expect(basicLookupProvesUsDestination(value, observation)).toBe(false);
  });

  it("does not construct a provider outside a real production deployment", () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    expect(makeTwilioSmsProvider("AC" + "a".repeat(32))).toBeNull();
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    expect(makeTwilioSmsProvider("AC" + "a".repeat(32))).toBeNull();
  });
});
