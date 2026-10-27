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
import { isVaultField, maskUsername, pdfSafeText, rotationState, vaultLockFromFailures, wrapPdfText } from "@/domains/vault/rules";

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

describe("vaultLockFromFailures", () => {
  const at = (minutesAgo: number, base: Date) => new Date(base.getTime() - minutesAgo * 60_000);

  it("locks when five failures land inside one 15-minute span, until 30 minutes after the latest", () => {
    const now = new Date("2026-10-27T12:20:00Z");
    const failures = [0, 4, 8, 12, 14].map((m) => at(m + 6, now)); // latest failure 6 minutes ago
    const lock = vaultLockFromFailures(failures, now);
    expect(lock.locked).toBe(true);
    expect(lock.lockedUntil?.toISOString()).toBe("2026-10-27T12:44:00.000Z");
  });

  it("stays locked after the earliest failures age out of the counting window (Codex P2)", () => {
    // Five failures at noon; at 12:20 only the last two are still inside a
    // bare 15-minute query window, but the lock runs to 12:30.
    const noon = new Date("2026-10-27T12:00:00Z");
    const failures = [0, 3, 6, 9, 11].map((m) => new Date(noon.getTime() + m * 60_000));
    const lock = vaultLockFromFailures(failures, new Date("2026-10-27T12:20:00Z"));
    expect(lock.locked).toBe(true);
    expect(lock.lockedUntil?.toISOString()).toBe("2026-10-27T12:41:00.000Z");
    // And it really ends 30 minutes after the cluster's latest failure.
    expect(vaultLockFromFailures(failures, new Date("2026-10-27T12:41:00Z")).locked).toBe(false);
  });

  it("does not lock below the limit, or for failures spread beyond one window", () => {
    const now = new Date("2026-10-27T12:20:00Z");
    expect(vaultLockFromFailures([0, 2, 4, 6].map((m) => at(m, now)), now).locked).toBe(false);
    expect(vaultLockFromFailures([0, 10, 20, 30, 40].map((m) => at(m, now)), now).locked).toBe(false);
  });

  it("an old expired cluster plus one fresh failure does not re-lock", () => {
    const now = new Date("2026-10-27T13:00:00Z");
    const failures = [120, 118, 116, 114, 112, 1].map((m) => at(m, now));
    expect(vaultLockFromFailures(failures, now).locked).toBe(false);
  });
});

describe("wrapPdfText", () => {
  it("never drops a character of a long spaceless secret (Codex P2)", () => {
    const secret = "x".repeat(1000);
    const lines = wrapPdfText(secret, 105);
    expect(lines.length).toBe(10);
    expect(lines.every((l) => l.length <= 105)).toBe(true);
    expect(lines.join("")).toBe(secret);
  });

  it("wraps ordinary text at spaces and restores it exactly", () => {
    const text = "the quick brown fox jumps over the lazy dog again and again";
    const lines = wrapPdfText(text, 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 20)).toBe(true);
    expect(lines.join("")).toBe(text);
  });

  it("splits a long word that follows short words without losing it", () => {
    const word = "tok_" + "a".repeat(300);
    const text = `Password: ${word}`;
    const lines = wrapPdfText(text, 105);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(text);
    expect(lines.every((l) => l.length <= 105)).toBe(true);
  });

  it("keeps repeated, leading and trailing spaces exactly (Codex P2)", () => {
    // A password whose spaces ARE part of the secret: the old wrapper split
    // on single spaces and silently collapsed them in the export.
    const secret = "Password: alpha  beta   gamma ";
    const lines = wrapPdfText(secret, 105);
    expect(lines.join("")).toBe(secret);
    const wrapped = wrapPdfText("  aa  bb  cc  dd  ee", 7);
    expect(wrapped.every((l) => l.length <= 7)).toBe(true);
    expect(wrapped.join("")).toBe("  aa  bb  cc  dd  ee");
  });
});

describe("pdfSafeText", () => {
  it("replaces characters the PDF fonts cannot print with ?", () => {
    expect(pdfSafeText("code 🔑 done")).toBe("code ? done");
    expect(pdfSafeText("パスワード")).toBe("?????");
    expect(pdfSafeText("tab\there")).toBe("tab?here");
  });

  it("keeps everything WinAnsi can print, including accents and punctuation", () => {
    const text = "pässwörd — “quoted” • €5 … it’s";
    expect(pdfSafeText(text)).toBe(text);
    expect(pdfSafeText("line one\nline two")).toBe("line one\nline two");
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
