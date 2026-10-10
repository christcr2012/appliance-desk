import { describe, expect, it } from "vitest";
import { metricoolConfig, metricoolVisit } from "@/lib/metricool";

const hash = "0123456789abcdef0123456789abcdef";
const input = { hash, siteOrigin: "https://example.test", url: "https://example.test/launch", referrer: "", width: 390, height: 844 };
describe("public Metricool visit boundary", () => {
  it("activates only a valid production HTTPS configuration", () => {
    expect(metricoolConfig("production", hash, input.siteOrigin)).toEqual({ hash, siteOrigin: input.siteOrigin });
    for (const runtime of [undefined, "preview", "development"]) expect(metricoolConfig(runtime, hash, input.siteOrigin)).toBeNull();
    expect(metricoolConfig("production", undefined, input.siteOrigin)).toBeNull();
    expect(metricoolConfig("production", "bad", input.siteOrigin)).toBeNull();
    expect(metricoolConfig("production", hash, "http://localhost")).toBeNull();
  });
  it.each(["/desk", "/account", "/login", "/sign/private", "/estimate/private", "/privacy", "/launch/unsubscribe", "/api/uploads/photo"])("never records private or token route %s", path => {
    expect(metricoolVisit({ ...input, url: input.siteOrigin + path })).toBeNull();
  });
  it("never records a preview or different origin", () => {
    expect(metricoolVisit({ ...input, url: "https://preview.example.test/" })).toBeNull();
  });
  it("keeps fixed campaign tags, removes private values, fragments and referrer paths", () => {
    const pixel = new URL(metricoolVisit({ ...input,
      url: input.url + "?utm_source=facebook&utm_content=post_01&email=customer%40example.test&token=private#private",
      referrer: "https://example.test/account?token=private",
    })!);
    expect(pixel.origin + pixel.pathname).toBe("https://tracker.metricool.com/c3po.jpg");
    expect(pixel.searchParams.get("u")).toBe(input.url + "?utm_source=facebook&utm_content=post_01");
    expect(pixel.searchParams.get("ref")).toBe(input.siteOrigin);
    expect(pixel.href).not.toContain("private");
    expect(pixel.searchParams.get("hash")).toBe(hash);
    expect(pixel.searchParams.get("bw")).toBe("390");
  });
  it("rejects personal values masquerading as campaign labels", () => {
    const pixel = new URL(metricoolVisit({ ...input, url: input.url + "?utm_source=customer%40example.test&utm_term=%2B19701234567&utm_content=privatetoken123&utm_campaign=customername" })!);
    expect(pixel.searchParams.get("u")).toBe(input.url);
  });
  it("honors both browser privacy signals", () => {
    expect(metricoolVisit({ ...input, doNotTrack: "1" })).toBeNull();
    expect(metricoolVisit({ ...input, globalPrivacyControl: true })).toBeNull();
  });
});
