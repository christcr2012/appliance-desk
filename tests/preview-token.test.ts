import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewToken, verifyToken } from "@/lib/preview-token";

const errors = { label: "Test preview", error: (message: string) => new Error(message) };
const saved = { better: process.env.BETTER_AUTH_SECRET, auth: process.env.AUTH_SECRET };

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "a-test-only-secret-that-is-long-enough-123";
  delete process.env.AUTH_SECRET;
});
afterEach(() => {
  if (saved.better === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = saved.better;
  if (saved.auth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = saved.auth;
});

describe("signed preview tokens (shared by bank imports and decision answers)", () => {
  it("round-trips the claims", () => {
    const token = previewToken({ v: 1, uid: "owner", sha: "a".repeat(64), exp: 123 }, errors);
    expect(verifyToken(token, errors)).toEqual({ v: 1, uid: "owner", sha: "a".repeat(64), exp: 123 });
  });

  it("refuses a changed token or a token signed with another secret", () => {
    const token = previewToken({ v: 1, uid: "owner" }, errors);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, uid: "someone-else" })).toString("base64url");
    expect(() => verifyToken(`${forged}.${sig}`, errors)).toThrow("Test preview token is not valid.");
    expect(() => verifyToken(`${payload}.${sig}.x`, errors)).toThrow("Test preview token is invalid.");
    process.env.BETTER_AUTH_SECRET = "another-test-only-secret-that-is-long-enough";
    expect(() => verifyToken(token, errors)).toThrow("Test preview token is not valid.");
  });

  it("refuses to sign with a missing or short secret", () => {
    process.env.BETTER_AUTH_SECRET = "short";
    expect(() => previewToken({ v: 1 }, errors)).toThrow("Test preview signing is not securely configured.");
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => previewToken({ v: 1 }, errors)).toThrow("Test preview signing is not securely configured.");
  });
});
