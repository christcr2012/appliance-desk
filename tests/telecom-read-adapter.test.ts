import { describe, expect, it } from "vitest";
import { createTwilioReadAdapter } from "@/lib/communications/providers/twilio-read";

const sid = "AC" + "a".repeat(32);
const messageSid = "SM" + "b".repeat(32);
const root = "/2010-04-01/Accounts/" + sid;
const from = new Date("2026-10-01T00:00:00Z");
const through = new Date("2026-10-03T00:00:00Z");
const config = { accountSid: sid, apiKey: "ci-key", apiSecret: "ci-secret" };
function mock(value: object, called?: (url: URL, init: RequestInit) => void) {
  return createTwilioReadAdapter(config, async (url, init) => {
    called?.(new URL(url), init);
    return new Response(JSON.stringify(value), { status: 200,
      headers: { "content-type": "application/json" } });
  });
}
const input = { start: from, end: through, next: null, primaryNumberId: null };

describe("COM-L11 read-only Twilio adapter", () => {
  it("only GETs scoped and GMT-bounded usage with subaccounts excluded", async () => {
    let visited = 0;
    const adapter = mock({ usage_records: [{
      category: "totalprice", count: "1", count_unit: "calls",
      usage: "-0.0100", usage_unit: "usd", price: "-0.0100",
      price_unit: "usd", start_date: "2026-10-01", end_date: "2026-10-02",
    }], next_page_uri: null }, (url, init) => {
      visited++;
      expect(init.method).toBe("GET");
      expect(url.origin).toBe("https://api.twilio.com");
      expect(url.pathname).toBe(root + "/Usage/Records.json");
      expect(url.searchParams.get("StartDate")).toBe("2026-10-01");
      expect(url.searchParams.get("EndDate")).toBe("2026-10-02");
      expect(url.searchParams.get("IncludeSubaccounts")).toBe("false");
    });
    const result = await adapter.read({ ...input, resource: "USAGE" });
    expect(visited).toBe(1);
    expect(result.kind).toBe("USAGE");
    if (result.kind !== "USAGE") throw new Error("type");
    expect(result.items[0].price).toBe("-0.0100000000");
    expect(result.items[0].usage).toBe("-0.0100000000");
    expect(result.items[0].isTotal).toBe(true);
    expect(result.items[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects provider cursor SSRF, account spoofing, and cursor cycles", async () => {
    let sent = 0;
    const adapter = mock({ messages: [{
      sid: messageSid, account_sid: "AC" + "f".repeat(32),
      price: "-0.0075", price_unit: "USD", date_sent: "2026-10-01T12:00:00Z",
    }] }, () => { sent++; });
    await expect(adapter.read({ ...input, resource: "MESSAGES",
      next: "https://example.com/private" })).rejects.toThrow("INVALID_PROVIDER_CURSOR");
    await expect(adapter.read({ ...input, resource: "MESSAGES",
      next: root + "/Calls.json?Page=1" })).rejects.toThrow("INVALID_PROVIDER_CURSOR");
    expect(sent).toBe(0);
    await expect(adapter.read({ ...input, resource: "MESSAGES" }))
      .rejects.toThrow("PROVIDER_ACCOUNT_MISMATCH");
    expect(sent).toBe(1);
  });
  it("keeps missing/numeric JSON prices unknown, not rounded floats", async () => {
    const adapter = mock({ messages: [{
      sid: messageSid, account_sid: sid, date_sent: "2026-10-01T12:00:00Z",
      num_segments: "2", price: 0.0083, price_unit: "USD",
    }] });
    const result = await adapter.read({ ...input, resource: "MESSAGES" });
    if (result.kind !== "MESSAGES") throw new Error("type");
    expect(result.items[0].price).toBeNull();
    expect(result.items[0].quantity).toBe("2.0000000000");
  });
  it("readiness only observes account/number and never makes activation claims", async () => {
    const urls: string[] = [];
    const numberId = "PN" + "c".repeat(32);
    const adapter = createTwilioReadAdapter(config, async (url, init) => {
      urls.push(new URL(url).pathname);
      expect(init.method).toBe("GET");
      const data = urls.length === 1 ? { sid, status: "active" }
        : { sid: numberId, account_sid: sid,
            capabilities: { sms: true, voice: false } };
      return new Response(JSON.stringify(data), { status: 200 });
    });
    const result = await adapter.read({ ...input, resource: "READINESS", primaryNumberId: numberId });
    if (result.kind !== "READINESS") throw new Error("type");
    expect(result.items[0]).toMatchObject({ numberConfirmed: true, sms: true, voice: false });
    expect(urls).toEqual([root + ".json", root + "/IncomingPhoneNumbers/" + numberId + ".json"]);
  });
  it("only accepts exact string price tiers from US pricing, not floats", async () => {
    const adapter = mock({
      iso_country: "US", price_unit: "usd",
      outbound_sms_prices: [{ mcc: "310", mnc: "410", prices: [
        { number_type: "local", current_price: "0.0083000000" },
        { number_type: "mobile", current_price: 0.0083 },
      ] }],
      inbound_sms_prices: [{ number_type: "local", current_price: "0.0075000000" }],
    }, (url, init) => { expect(init.method).toBe("GET"); expect(url.host).toBe("pricing.twilio.com"); });
    const result = await adapter.read({ ...input, resource: "PRICING" });
    if (result.kind !== "PRICING") throw new Error("type");
    expect(result.items).toHaveLength(2);
    expect(result.items.map(i => i.rate)).toEqual(["0.0083000000", "0.0075000000"]);
  });
  it("rejects a continuation that drops the GMT range or includes subaccounts", async () => {
    const base = root + "/Usage/Records.json";
    const safe = base + "?StartDate=2026-10-01&EndDate=2026-10-02&IncludeSubaccounts=false&PageSize=50&Page=1";
    const body = { usage_records: [], next_page_uri: safe };
    const provider = mock(body);
    const first = await provider.read({ ...input, resource: "USAGE" });
    expect(first.next).toBe(safe);
    await expect(provider.read({ ...input, resource: "USAGE",
      next: base + "?StartDate=2026-10-01&EndDate=2026-11-02&IncludeSubaccounts=false" }))
      .rejects.toThrow("INVALID_PROVIDER_CURSOR");
    await expect(provider.read({ ...input, resource: "USAGE",
      next: base + "?StartDate=2026-10-01&EndDate=2026-10-02&IncludeSubaccounts=true" }))
      .rejects.toThrow("INVALID_PROVIDER_CURSOR");
    const changed = mock({ usage_records: [], next_page_uri:
      base + "?StartDate=2026-10-01&EndDate=2026-10-02&IncludeSubaccounts=true" });
    await expect(changed.read({ ...input, resource: "USAGE" }))
      .rejects.toThrow("INVALID_PROVIDER_CURSOR");
  });
});
