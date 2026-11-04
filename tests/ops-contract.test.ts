import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OPS_NOTE_CATEGORIES,
  OPS_RATE_LIMIT,
  OPS_RECOMMENDATIONS,
  opsDiscoveryDocument,
  opsHandoffText,
  opsOriginFromHost,
} from "@/domains/system-issues/ops-contract";

// The fixed contract texts are the API's public promise (they were the
// private constants in ops-api.ts before OPS-HANDOFF-1). Pin them so an
// accidental edit fails loudly instead of silently changing what every
// assistant was told.
const FIXED_RECOMMENDATIONS = {
  INVESTIGATE_CODE: "Review the affected code and reproduce the reported behavior with regression tests.",
  OWNER_CONFIGURATION: "Owner action: review the related settings; do not paste access credentials.",
  VERIFY_PROVIDER: "The provider outcome is uncertain. Reconcile durable provider evidence before retrying.",
  REVIEW_SOURCE: "Verify the official source manually before changing any business or tax setting.",
};

describe("OPS-HANDOFF-1 published contract constants", () => {
  it("publishes exactly the categories and fixed recommendations the API enforces", () => {
    expect(OPS_NOTE_CATEGORIES).toEqual(["OWNER_ACTION", "CODE_FINDING", "QUESTION"]);
    expect(OPS_RECOMMENDATIONS).toEqual(FIXED_RECOMMENDATIONS);
    expect(OPS_RATE_LIMIT).toEqual({ max: 60, windowMs: 3_600_000 });
  });
});

describe("OPS-HANDOFF-1 discovery document", () => {
  const doc = opsDiscoveryDocument("https://testing.example.test/");

  it("is written for the deployment it is fetched from, trailing slash trimmed", () => {
    expect(doc.baseUrl).toBe("https://testing.example.test");
    expect(doc.discovery.url).toBe("https://testing.example.test/api/ops");
    expect(doc.discovery.authenticationRequired).toBe(false);
  });

  it("names both endpoints, the Bearer format and the full note contract", () => {
    const [read, note] = doc.endpoints;
    expect(read).toMatchObject({ method: "GET", path: "/api/ops/issues" });
    expect(note).toMatchObject({ method: "POST", path: "/api/ops/issues/{issueId}/notes" });
    expect(doc.authentication.format).toBe("Bearer <key>");
    expect(Object.keys(doc.noteContract.categories)).toEqual([...OPS_NOTE_CATEGORIES]);
    expect(doc.noteContract.recommendations).toEqual(FIXED_RECOMMENDATIONS);
    expect(doc.noteContract.fields.expectedVersion).toContain("409");
  });

  it("publishes the enforced rate limit and the error answers", () => {
    expect(doc.rateLimit.requests).toBe(60);
    expect(doc.rateLimit.window).toBe("1 hour");
    expect(Object.keys(doc.errors)).toEqual(["404", "409", "422", "429"]);
  });

  it("states what the data deliberately excludes and carries no issue data", () => {
    expect(doc.dataPolicy.deliberatelyExcluded).toContain("No customer names or ids");
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("keyHash");
    expect(doc).not.toHaveProperty("issues");
  });
});

describe("OPS-HANDOFF-1 hand-off block", () => {
  // Generated at runtime: never commit a key-shaped constant (secret scan).
  const key = randomBytes(32).toString("base64url");
  const text = opsHandoffText({ baseUrl: "https://testing.example.test", key });

  it("is a complete one-paste package: key, address, auth, endpoints, job", () => {
    expect(text).toContain(key);
    expect(text).toContain("APP ADDRESS: https://testing.example.test");
    expect(text).toContain(`Authorization: Bearer ${key}`);
    expect(text).toContain("GET https://testing.example.test/api/ops/issues?limit=25");
    expect(text).toContain("POST https://testing.example.test/api/ops/issues/<issue id>/notes");
    expect(text).toContain("GET https://testing.example.test/api/ops");
    expect(text).toContain("YOUR JOB — A CHECK-UP");
  });

  it("carries every category and every fixed recommendation sentence", () => {
    for (const category of OPS_NOTE_CATEGORIES) expect(text).toContain(category);
    for (const [recommendationKey, sentence] of Object.entries(FIXED_RECOMMENDATIONS)) {
      expect(text).toContain(recommendationKey);
      expect(text).toContain(sentence);
    }
  });

  it("carries the limits, the error answers and the deliberate exclusions", () => {
    expect(text).toContain("60 requests per hour");
    expect(text).toContain("HTTP 429");
    expect(text).toContain("HTTP 404");
    expect(text).toContain("HTTP 409");
    expect(text).toContain("HTTP 422");
    expect(text).toContain("no customer names or ids");
  });
});

describe("OPS-HANDOFF-1 deployment origin from host header", () => {
  it("uses https for real hosts and http only for local development", () => {
    expect(opsOriginFromHost("appliance-desk-testing.vercel.app")).toBe("https://appliance-desk-testing.vercel.app");
    expect(opsOriginFromHost("robinsonappliancerentals.com")).toBe("https://robinsonappliancerentals.com");
    expect(opsOriginFromHost("localhost:3000")).toBe("http://localhost:3000");
    expect(opsOriginFromHost("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("refuses hosts that are missing or not plain host names", () => {
    expect(opsOriginFromHost(null)).toBeNull();
    expect(opsOriginFromHost("")).toBeNull();
    expect(opsOriginFromHost("intranet")).toBeNull();
    expect(opsOriginFromHost("evil.example.test/path")).toBeNull();
    expect(opsOriginFromHost("evil.example.test@other.test")).toBeNull();
  });
});
