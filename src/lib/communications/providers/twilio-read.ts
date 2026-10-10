import { createHash } from "node:crypto";
import { telecomDecimal } from "@/domains/messaging/telecom-decimal";
import type { TelecomSyncResource } from "@prisma/client";

// GET-only, bounded and account-pinned. No provider mutations or paid Lookup.
const SID = /^AC[0-9a-fA-F]{32}$/;
const RESOURCE_SID = /^(SM|MM|CA)[0-9a-fA-F]{32}$/;
const NUMBER_SID = /^PN[0-9a-fA-F]{32}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOST = "https://api.twilio.com";
const PRICE_HOST = "https://pricing.twilio.com";
const MAX_BYTES = 512_000;
const PAGE_SIZE = 50;

export type TelecomReadPage =
  | { kind: "USAGE"; items: Array<{
      category: string; startDate: string; endDate: string; count: string;
      countUnit: string; usage: string; usageUnit: string; price: string | null;
      currency: string; isTotal: boolean; hash: string;
    }>; next: string | null }
  | { kind: "MESSAGES" | "CALLS"; items: Array<{
      sid: string; accountSid: string; price: string | null; currency: string | null;
      occurredAt: string; quantity: string | null; unit: string;
    }>; next: string | null }
  | { kind: "PRICING"; items: Array<{
      service: string; category: string; destinationCountry: string;
      destinationPrefix: string | null; destinationKey: string; senderType: string;
      component: string; rate: string; currency: string; unit: string;
    }>; next: null }
  | { kind: "READINESS"; items: Array<{
      accountStatus: string; numberId: string | null;
      numberConfirmed: boolean; voice: boolean | null; sms: boolean | null;
    }>; next: null };

export interface TelecomReadAdapter {
  read(input: {
    resource: TelecomSyncResource; start: Date; end: Date;
    next: string | null; primaryNumberId: string | null;
  }): Promise<TelecomReadPage>;
}

type Requester = (input: string, init: RequestInit) => Promise<Response>;
type ProviderConfig = { accountSid: string; apiKey: string; apiSecret: string };
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PROVIDER_DATA");
  return value as JsonObject;
}
function text(value: unknown, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("INVALID_PROVIDER_DATA");
  return value;
}
function optionalPrice(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  // Twilio documents some API prices as numbers; a JSON float cannot prove
  // the provider's exact decimal spelling. Retain UNKNOWN, never guess.
  if (typeof value !== "string") return null;
  return telecomDecimal(value).toFixed(10);
}
function currency(value: unknown): string {
  const normalized = text(value, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("INVALID_PROVIDER_DATA");
  return normalized;
}
function decimalCount(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_PROVIDER_DATA");
  const d = telecomDecimal(value);
  if (d.isNegative()) throw new Error("INVALID_PROVIDER_DATA");
  return d.toFixed(10);
}
function validGMT(value: unknown): string {
  const s = text(value, 10);
  if (!DATE.test(s) || !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
      new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s) {
    throw new Error("INVALID_PROVIDER_DATE");
  }
  return s;
}
function providerTime(value: unknown): string {
  const s = text(value, 90);
  const at = new Date(s);
  if (!Number.isFinite(at.getTime())) throw new Error("INVALID_PROVIDER_DATE");
  return at.toISOString();
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function safePage(next: string | null, sid: string, resource: "USAGE" | "MESSAGES" | "CALLS"): string {
  const suffix = resource === "USAGE" ? "Usage/Records.json"
    : resource === "MESSAGES" ? "Messages.json" : "Calls.json";
  const pathname = `/2010-04-01/Accounts/${sid}/${suffix}`;
  if (!next) return pathname;
  if (next.length > 4096 || next.includes("@") || next.includes("#")) throw new Error("INVALID_PROVIDER_CURSOR");
  const target = new URL(next, HOST);
  if (target.origin !== HOST || target.pathname !== pathname ||
      target.username || target.password || target.searchParams.toString().length > 4000) {
    throw new Error("INVALID_PROVIDER_CURSOR");
  }
  return target.pathname + target.search;
}

/** Requestor injection is test-only; this object exposes no POST capability. */
export function createTwilioReadAdapter(config: ProviderConfig, requester: Requester = fetch): TelecomReadAdapter {
  if (!SID.test(config.accountSid) || !config.apiKey || !config.apiSecret) {
    throw new Error("TELECOM_UNCONFIGURED");
  }
  const authorization = "Basic " + Buffer.from(config.apiKey + ":" + config.apiSecret).toString("base64");
  const base = `/2010-04-01/Accounts/${config.accountSid}`;
  async function read(url: string): Promise<JsonObject> {
    const parsed = new URL(url);
    if ((parsed.origin !== HOST && parsed.origin !== PRICE_HOST) || parsed.username || parsed.password) {
      throw new Error("INVALID_PROVIDER_CURSOR");
    }
    const response = await requester(url, {
      method: "GET", headers: { authorization, accept: "application/json" },
      signal: AbortSignal.timeout(9000), redirect: "error",
    });
    if (!response.ok) throw new Error(response.status === 429 ? "TELECOM_RATE_LIMITED" : "TELECOM_PROVIDER_UNAVAILABLE");
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > MAX_BYTES) throw new Error("PROVIDER_PAGE_TOO_LARGE");
    const raw = await response.text();
    if (raw.length > MAX_BYTES) throw new Error("PROVIDER_PAGE_TOO_LARGE");
    try { return object(JSON.parse(raw)); } catch { throw new Error("INVALID_PROVIDER_DATA"); }
  }
  return {
    async read({ resource, start, end, next, primaryNumberId }): Promise<TelecomReadPage> {
      if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(+start) ||
          !Number.isFinite(+end) || +start >= +end) throw new Error("INVALID_SYNC_WINDOW");
      if (resource === "READINESS") {
        if (next) throw new Error("INVALID_PROVIDER_CURSOR");
        const acct = await read(HOST + base + ".json");
        if (acct.sid !== config.accountSid) throw new Error("PROVIDER_ACCOUNT_MISMATCH");
        let numberConfirmed = false, voice: boolean | null = null, sms: boolean | null = null;
        if (primaryNumberId) {
          if (!NUMBER_SID.test(primaryNumberId)) throw new Error("INVALID_NUMBER_ID");
          const number = await read(HOST + base + "/IncomingPhoneNumbers/" + primaryNumberId + ".json");
          if (number.account_sid !== config.accountSid || number.sid !== primaryNumberId) {
            throw new Error("PROVIDER_ACCOUNT_MISMATCH");
          }
          const capabilities = object(number.capabilities);
          numberConfirmed = true;
          voice = typeof capabilities.voice === "boolean" ? capabilities.voice : null;
          sms = typeof capabilities.sms === "boolean" ? capabilities.sms : null;
        }
        return { kind: "READINESS", next: null, items: [{
          accountStatus: text(acct.status, 30), numberId: primaryNumberId,
          numberConfirmed, voice, sms,
        }] };
      }
      if (resource === "PRICING") {
        if (next) throw new Error("INVALID_PROVIDER_CURSOR");
        const data = await read(PRICE_HOST + "/v1/Messaging/Countries/US");
        if (data.iso_country !== "US") throw new Error("PROVIDER_COUNTRY_MISMATCH");
        const unit = currency(data.price_unit);
        const outbound = data.outbound_sms_prices;
        const inbound = data.inbound_sms_prices;
        if (!Array.isArray(outbound) || !Array.isArray(inbound) ||
            outbound.length > 300 || inbound.length > 30) throw new Error("INVALID_PROVIDER_DATA");
        const items: Extract<TelecomReadPage, { kind: "PRICING" }>["items"] = [];
        for (const band of outbound) {
          const b = object(band);
          const mcc = text(b.mcc, 3), mnc = text(b.mnc, 3);
          if (!/^\d{2,3}$/.test(mcc) || !/^\d{2,3}$/.test(mnc)) throw new Error("INVALID_PROVIDER_DATA");
          if (!Array.isArray(b.prices) || b.prices.length > 10) throw new Error("INVALID_PROVIDER_DATA");
          for (const tier of b.prices) {
            const t = object(tier); const rate = optionalPrice(t.current_price);
            if (rate === null) continue;
            items.push({
              service: "SMS", category: "outbound", destinationCountry: "US",
              destinationPrefix: mcc + ":" + mnc, destinationKey: "US:" + mcc + ":" + mnc + ":outbound:" + text(t.number_type, 30),
              senderType: text(t.number_type, 30), component: "base", rate,
              currency: unit, unit: "segment",
            });
          }
        }
        for (const tier of inbound) {
          const t = object(tier); const rate = optionalPrice(t.current_price);
          if (rate === null) continue;
          items.push({
            service: "SMS", category: "inbound", destinationCountry: "US",
            destinationPrefix: null, destinationKey: "US:inbound:" + text(t.number_type, 30),
            senderType: text(t.number_type, 30), component: "base", rate,
            currency: unit, unit: "segment",
          });
        }
        if (items.length > 500) throw new Error("PROVIDER_PAGE_TOO_LARGE");
        return { kind: "PRICING", items, next: null };
      }
      const path = safePage(next, config.accountSid, resource);
      if (next) validatePageWindow(next, resource, start, end);
      const target = new URL(HOST + path);
      if (!next) {
        target.searchParams.set("PageSize", String(PAGE_SIZE));
        const begin = start.toISOString().slice(0, 10);
        // Exclusive UTC end -> inclusive GMT last day. DST is irrelevant.
        const last = new Date(end.getTime() - 1).toISOString().slice(0, 10);
        const prefix = resource === "USAGE" ? "" : resource === "MESSAGES" ? "DateSent" : "StartTime";
        target.searchParams.set(prefix ? prefix + ">=" : "StartDate", begin);
        target.searchParams.set(prefix ? prefix + "<=" : "EndDate", last);
        if (resource === "USAGE") target.searchParams.set("IncludeSubaccounts", "false");
      }
      const data = await read(target.toString());
      const raw = data[resource === "USAGE" ? "usage_records" : resource.toLowerCase()];
      if (!Array.isArray(raw) || raw.length > PAGE_SIZE) throw new Error("INVALID_PROVIDER_DATA");
      const providerNext = data.next_page_uri == null ? null : text(data.next_page_uri, 4096);
      if (providerNext) safePage(providerNext, config.accountSid, resource);
      if (providerNext) validatePageWindow(providerNext, resource, start, end);
      if (resource === "USAGE") {
        const items = raw.map(item => {
          const v = object(item);
          const count = decimalCount(v.count); const usage = typeof v.usage === "string"
            ? telecomDecimal(v.usage).toFixed(10) : (() => { throw new Error("INVALID_PROVIDER_DATA"); })();
          const record = {
            category: text(v.category), startDate: validGMT(v.start_date), endDate: validGMT(v.end_date),
            count, countUnit: text(v.count_unit, 80), usage, usageUnit: text(v.usage_unit, 80),
            price: optionalPrice(v.price), currency: currency(v.price_unit), isTotal: v.category === "totalprice",
          };
          if (record.endDate < record.startDate) throw new Error("INVALID_PROVIDER_DATE");
          return { ...record, hash: hash(record) };
        });
        return { kind: "USAGE", items, next: providerNext };
      }
      const kind = resource as "MESSAGES" | "CALLS";
      const items = raw.map(item => {
        const v = object(item), sid = text(v.sid, 34);
        if (!RESOURCE_SID.test(sid) || v.account_sid !== config.accountSid) {
          throw new Error("PROVIDER_ACCOUNT_MISMATCH");
        }
        const observedPrice = optionalPrice(v.price);
        const rawCurrency = v.price_unit;
        return {
          sid, accountSid: config.accountSid, price: observedPrice,
          currency: rawCurrency == null ? null : currency(rawCurrency),
          occurredAt: providerTime(v.date_sent ?? v.start_time ?? v.date_created),
          quantity: resource === "MESSAGES"
            ? (typeof v.num_segments === "string" ? decimalCount(v.num_segments) : null)
            : (typeof v.duration === "string" ? decimalCount(v.duration) : null),
          unit: resource === "MESSAGES" ? "segments" : "seconds",
        };
      });
      return { kind, items, next: providerNext };
    },
  };
}

/** No provider client is created in CI, previews or without approved account credentials. */
export function makeTwilioReadAdapter(accountSid: string): TelecomReadAdapter | null {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production" ||
      process.env.TWILIO_ACCOUNT_SID !== accountSid || !SID.test(accountSid) ||
      !process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET) return null;
  return createTwilioReadAdapter({
    accountSid, apiKey: process.env.TWILIO_API_KEY, apiSecret: process.env.TWILIO_API_SECRET,
  });
}
function validatePageWindow(
  cursor: string, resource: "USAGE" | "MESSAGES" | "CALLS", start: Date, end: Date,
): void {
  const query = new URL(cursor, HOST).searchParams;
  const prefix = resource === "USAGE" ? "" : resource === "MESSAGES" ? "DateSent" : "StartTime";
  const begin = start.toISOString().slice(0, 10);
  const last = new Date(end.getTime() - 1).toISOString().slice(0, 10);
  if (query.get(prefix ? prefix + ">=" : "StartDate") !== begin ||
      query.get(prefix ? prefix + "<=" : "EndDate") !== last ||
      (resource === "USAGE" && query.get("IncludeSubaccounts") !== "false") ||
      (query.has("PageSize") && (!/^\d+$/.test(query.get("PageSize") ?? "") ||
        Number(query.get("PageSize")) > PAGE_SIZE))) {
    throw new Error("INVALID_PROVIDER_CURSOR");
  }
}
