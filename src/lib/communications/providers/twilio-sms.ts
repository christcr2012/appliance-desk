import twilio from "twilio";
import type { TelecomSmsProvider, SmsSubmitOutcome, SmsProviderInput } from "./types";

export function classifyTwilioSubmitError(error: unknown): SmsSubmitOutcome {
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof status === "number" && status >= 400 && status < 500 &&
      status !== 408 && status !== 429) {
    return { kind: "REJECTED", code: typeof code === "number" ? String(code) : "TWILIO_REJECTED" };
  }
  // A timed-out, rate-limited, or server-failed POST may already have created a
  // remote Message. UNKNOWN is not safe to retry automatically.
  return { kind: "UNKNOWN" };
}

/** Free Twilio Basic Lookup; never infer US from a +1 prefix alone. */
export function basicLookupProvesUsDestination(
  address: string,
  observation: { valid?: boolean | null; countryCode?: string | null; phoneNumber?: string | null },
): boolean {
  return observation.valid === true && observation.countryCode === "US" &&
    observation.phoneNumber === address;
}

/** No external provider can be constructed outside explicitly configured production. */
export function makeTwilioSmsProvider(accountSid: string): TelecomSmsProvider | null {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") return null;
  const configuredSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid) ||
      configuredSid !== accountSid || !apiKey || !apiSecret) return null;
  const client = twilio(apiKey, apiSecret, { accountSid });
  return {
    async verifyUsDestination(address: string): Promise<boolean> {
      if (!/^\+\d{8,15}$/.test(address)) return false;
      try {
        // Basic Lookup is free; NEVER pass Fields (paid packages).
        const observation = await client.lookups.v2.phoneNumbers(address).fetch();
        return basicLookupProvesUsDestination(address, observation);
      } catch {
        return false; // No known country means no send, not a guess from +1.
      }
    },
    async sendSms(input: SmsProviderInput): Promise<SmsSubmitOutcome> {
      if (!/^\+\d{8,15}$/.test(input.from) || !/^\+\d{8,15}$/.test(input.to) ||
          !input.text.trim() || !input.operationId ||
          !/^https:\/\/[A-Za-z0-9.-]+\//.test(input.callbackUrl) ||
          input.callbackUrl.includes("@")) {
        return { kind: "NOT_ATTEMPTED", reason: "INVALID_PROVIDER_REQUEST" };
      }
      try {
        // The operation ID is local correlation, never a claimed Twilio
        // idempotency header; one ambiguous POST must not be issued twice.
        const row = await client.messages.create({
          from: input.from, to: input.to, body: input.text, statusCallback: input.callbackUrl,
        });
        return row.sid ? { kind: "ACCEPTED", resourceId: row.sid } : { kind: "UNKNOWN" };
      } catch (error) {
        return classifyTwilioSubmitError(error);
      }
    },
  };
}
