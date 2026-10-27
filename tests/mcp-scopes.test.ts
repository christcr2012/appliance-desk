import { afterEach, describe, expect, it } from "vitest";
import { getMcpIssuer, validateMcpRedirectUri } from "../src/mcp/issuer";
import { grantedMcpScopes, MCP_SCOPES, SCOPE_WORDS } from "../src/mcp/scopes";

const original = process.env.MCP_ISSUER_URL;
afterEach(() => {
  if (original === undefined) delete process.env.MCP_ISSUER_URL;
  else process.env.MCP_ISSUER_URL = original;
});

describe("MCP consent configuration", () => {
  it("does not derive an issuer if the operator has not configured it", () => {
    delete process.env.MCP_ISSUER_URL;
    expect(getMcpIssuer()).toBeNull();
  });
  it("rejects an unsafe issuer origin", () => {
    for (const candidate of ["https://assistant.example/test", "http://assistant.example", "https://evil.example@assistant.example/", "javascript:foo", "https://assistant.example/?token=abc"]) {
      process.env.MCP_ISSUER_URL = candidate;
      expect(getMcpIssuer()).toBeNull();
    }
    process.env.MCP_ISSUER_URL = "https://assistant.example/";
    expect(getMcpIssuer()).toBe("https://assistant.example");
  });
  it("keeps bearer grants within the two approved scopes", () => {
    expect(MCP_SCOPES.every((scope) => Boolean(SCOPE_WORDS[scope]))).toBe(true);
    expect(grantedMcpScopes(["ops:read", "write:all"], ["ops:read", "decisions:read"])).toEqual(["ops:read"]);
  });
  it("refuses a changed or dangerous redirect", () => {
    const callbacks = ["https://client.example/callback", "http://127.0.0.1:3100/callback"];
    expect(validateMcpRedirectUri(callbacks[0], callbacks, true)).toBe(true);
    expect(validateMcpRedirectUri("https://evil.example/callback", callbacks, false)).toBe(false);
    expect(validateMcpRedirectUri("http://evil.example/callback", callbacks, true)).toBe(false);
    expect(validateMcpRedirectUri("https://client.example/callback#bad", callbacks, true)).toBe(false);
    expect(validateMcpRedirectUri(callbacks[1], callbacks, true)).toBe(true);
  });
});
