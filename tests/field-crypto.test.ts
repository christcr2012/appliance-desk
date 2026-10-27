import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// CMP-1: field crypto — AES-256-GCM round trip, fail-closed without a key,
// tamper evidence, and no plaintext in the stored value.

const TEST_KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const ENV = "COMPLIANCE_ENCRYPTION_KEY";

let cryptoModule: typeof import("@/lib/field-crypto");

beforeEach(async () => {
  process.env[ENV] = TEST_KEY;
  cryptoModule = await import("@/lib/field-crypto");
});

afterEach(() => {
  delete process.env[ENV];
});

describe("field crypto", () => {
  it("round-trips a tax id and stores no plaintext", () => {
    const stored = cryptoModule.encryptField("12-3456789");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("12-3456789");
    expect(stored).not.toContain("3456789");
    expect(cryptoModule.decryptField(stored)).toBe("12-3456789");
  });

  it("encrypts the same value differently each time (fresh IV)", () => {
    expect(cryptoModule.encryptField("12-3456789")).not.toBe(
      cryptoModule.encryptField("12-3456789"),
    );
  });

  it("refuses a tampered value and a value from another key", async () => {
    const stored = cryptoModule.encryptField("12-3456789");
    const parts = stored.split(":");
    parts[3] = (parts[3]![0] === "A" ? "B" : "A") + parts[3]!.slice(1);
    expect(() => cryptoModule.decryptField(parts.join(":"))).toThrow();

    process.env[ENV] = OTHER_KEY;
    const other = await import("@/lib/field-crypto");
    expect(() => other.decryptField(stored)).toThrow();
  });

  it("rejects values that are not in the encrypted format", () => {
    expect(() => cryptoModule.decryptField("12-3456789")).toThrow(/format/);
    expect(() => cryptoModule.decryptField("v2:aa:bb:cc")).toThrow(/format/);
  });

  it("fails closed when the key is missing or malformed", async () => {
    delete process.env[ENV];
    const noKey = await import("@/lib/field-crypto");
    expect(noKey.hasFieldCryptoKey()).toBe(false);
    expect(() => noKey.encryptField("12-3456789")).toThrow(/can't be stored safely/);

    process.env[ENV] = "not-a-key";
    const badKey = await import("@/lib/field-crypto");
    expect(badKey.hasFieldCryptoKey()).toBe(false);
    expect(() => badKey.encryptField("12-3456789")).toThrow(/can't be stored safely/);
  });

  it("reports a configured key", () => {
    expect(cryptoModule.hasFieldCryptoKey()).toBe(true);
  });
});
