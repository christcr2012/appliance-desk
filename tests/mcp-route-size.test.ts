import { describe, expect, it } from "vitest";
import { mcpPostBodyTooLarge } from "../src/mcp/request-size";

describe("bounded MCP HTTP requests", () => {
  const url = "https://desk.example/api/mcp";
  it("rejects an oversized content length before reading", async () => {
    const input = new Request(url, { method: "POST", body: "{}", headers: { "Content-Length": "1048577" } });
    expect(await mcpPostBodyTooLarge(input)).toBe(true);
  });
  it("rejects oversized streams without a content-length header", async () => {
    const input = new Request(url, { method: "POST", body: "x".repeat(1_048_577) });
    expect(input.headers.get("content-length")).toBeNull();
    expect(await mcpPostBodyTooLarge(input)).toBe(true);
  });
  it("leaves the authorized transport's body readable after inspecting it", async () => {
    const input = new Request(url, { method: "POST", body: '{"jsonrpc":"2.0"}' });
    expect(await mcpPostBodyTooLarge(input)).toBe(false);
    expect(await input.text()).toBe('{"jsonrpc":"2.0"}');
  });
  it("ignores GET requests and rejects malformed length declarations", async () => {
    expect(await mcpPostBodyTooLarge(new Request(url, { method: "GET" }))).toBe(false);
    expect(await mcpPostBodyTooLarge(new Request(url, {
      method: "POST", body: "x", headers: { "Content-Length": "not-a-number" },
    }))).toBe(true);
  });
});
