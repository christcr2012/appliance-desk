import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/ops/route";

describe("OPS-HANDOFF-1 keyless discovery route", () => {
  it("answers 200 with no key and describes the contract for its own origin", async () => {
    const response = await GET(new NextRequest("https://testing.example.test/api/ops"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.service).toContain("AI check-up");
    expect(body.baseUrl).toBe("https://testing.example.test");
    expect(body.authentication.format).toBe("Bearer <key>");
    expect(body.rateLimit.requests).toBe(60);
    expect(body).not.toHaveProperty("issues");
  });

  it("ignores a sent key — same document, and the key is never echoed", async () => {
    // Generated at runtime: never commit a key-shaped constant (secret scan).
    const key = randomBytes(32).toString("base64url");
    const response = await GET(new NextRequest("https://testing.example.test/api/ops", {
      headers: { authorization: `Bearer ${key}` },
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(key);
    expect(JSON.parse(text).baseUrl).toBe("https://testing.example.test");
  });
});
