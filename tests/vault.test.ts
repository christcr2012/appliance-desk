import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptField,
  decryptVaultField,
  encryptField,
  encryptVaultField,
  hasFieldCryptoKey,
  hasVaultCryptoKey,
} from "@/lib/field-crypto";
import { isVaultField, maskUsername, rotationState } from "@/domains/vault/rules";

/**
 * VAULT-2 unit tests: masking, rotation dates, and the vault key trio of
 * field-crypto (round-trip, missing/invalid key refusal, key separation from
 * the compliance trio, whose behaviour must stay exactly as CMP-1 left it).
 */

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.VAULT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.COMPLIANCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("maskUsername", () => {
  it("masks an email to its first character and domain", () => {
    expect(maskUsername("chris@bank.example")).toBe("c•••@bank.example");
  });
  it("masks a plain name to its first two characters", () => {
    expect(maskUsername("chrisr")).toBe("ch•••");
  });
  it("masks a two-character name to its first character", () => {
    expect(maskUsername("ab")).toBe("a•••");
  });
  it("passes null and empty through as null", () => {
    expect(maskUsername(null)).toBeNull();
    expect(maskUsername(undefined)).toBeNull();
    expect(maskUsername("")).toBeNull();
  });
});

describe("rotationState", () => {
  const created = new Date("2026-01-15T12:00:00Z");
  it("is null without a schedule", () => {
    expect(rotationState({ lastRotatedOn: null, createdAt: created, rotateEveryMonths: null }, new Date())).toBeNull();
    expect(rotationState({ lastRotatedOn: null, createdAt: created, rotateEveryMonths: 0 }, new Date())).toBeNull();
  });
  it("counts from creation when never rotated", () => {
    const state = rotationState(
      { lastRotatedOn: null, createdAt: created, rotateEveryMonths: 6 },
      new Date("2026-06-01T12:00:00Z"),
    );
    expect(state?.dueOnKey).toBe("2026-07-15");
    expect(state?.overdue).toBe(false);
  });
  it("is overdue on the due day itself", () => {
    const state = rotationState(
      { lastRotatedOn: null, createdAt: created, rotateEveryMonths: 6 },
      new Date("2026-07-15T18:00:00Z"),
    );
    expect(state?.overdue).toBe(true);
  });
  it("counts from the last rotation when there is one", () => {
    const state = rotationState(
      { lastRotatedOn: new Date("2026-03-31T12:00:00Z"), createdAt: created, rotateEveryMonths: 1 },
      new Date("2026-04-15T12:00:00Z"),
    );
    // March 31 + 1 month clamps to April 30.
    expect(state?.dueOnKey).toBe("2026-04-30");
    expect(state?.overdue).toBe(false);
  });
});

describe("field-crypto vault trio", () => {
  it("round-trips a value and uses the v1 format", () => {
    const stored = encryptVaultField("hunter2-but-longer");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("hunter2");
    expect(decryptVaultField(stored)).toBe("hunter2-but-longer");
  });
  it("refuses to encrypt without a key", () => {
    delete process.env.VAULT_ENCRYPTION_KEY;
    expect(hasVaultCryptoKey()).toBe(false);
    expect(() => encryptVaultField("x")).toThrow(/vault encryption key is not set/);
  });
  it("refuses a wrong-format key", () => {
    process.env.VAULT_ENCRYPTION_KEY = "not-a-key";
    expect(hasVaultCryptoKey()).toBe(false);
    expect(() => encryptVaultField("x")).toThrow(/not set/);
  });
  it("keeps the vault and compliance keys separate", () => {
    const vaultValue = encryptVaultField("vault-secret");
    const complianceValue = encryptField("compliance-secret");
    expect(() => decryptField(vaultValue)).toThrow();
    expect(() => decryptVaultField(complianceValue)).toThrow();
    expect(decryptVaultField(vaultValue)).toBe("vault-secret");
    expect(decryptField(complianceValue)).toBe("compliance-secret");
  });
  it("the compliance trio still works exactly as before", () => {
    expect(hasFieldCryptoKey()).toBe(true);
    const stored = encryptField("12-3456789");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptField(stored)).toBe("12-3456789");
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
    expect(hasFieldCryptoKey()).toBe(false);
    expect(() => encryptField("x")).toThrow(/compliance encryption key is not set/);
  });
  it("rejects a value that is not in the encrypted format", () => {
    expect(() => decryptVaultField("plain-text")).toThrow(/expected encrypted format/);
  });
});

describe("isVaultField", () => {
  it("accepts only the three revealable fields", () => {
    expect(isVaultField("username")).toBe(true);
    expect(isVaultField("password")).toBe(true);
    expect(isVaultField("notes")).toBe(true);
    expect(isVaultField("title")).toBe(false);
    expect(isVaultField("")).toBe(false);
  });
});
