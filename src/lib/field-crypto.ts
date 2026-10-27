import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// CMP-1: field-level encryption for stored tax ids (the business EIN today;
// supplier TINs in CMP-3). AES-256-GCM with a key that lives only in the
// environment (COMPLIANCE_ENCRYPTION_KEY, 32 bytes base64) — never in the
// database, an audit log, a backup manifest or this repository. Stored
// values carry a "v1:" version prefix so a future format can be told apart.
// Missing or invalid key material fails closed: encryption throws instead
// of ever persisting plaintext, and callers use hasFieldCryptoKey() to
// disable the field with an explanation instead of accepting a value they
// cannot protect.

const KEY_ENV = "COMPLIANCE_ENCRYPTION_KEY";
const VERSION = "v1";

function readKey(): Buffer | null {
  const encoded = process.env[KEY_ENV];
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 32 ? key : null;
}

function getKey(): Buffer {
  const key = readKey();
  if (!key) {
    throw new Error(
      "The compliance encryption key is not set, so this value can't be stored safely.",
    );
  }
  return key;
}

/** True when a valid encryption key is configured. */
export function hasFieldCryptoKey(): boolean {
  return readKey() !== null;
}

/** Encrypts one short field value. The result is safe to store in the database. */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a value written by encryptField. Only filing preparation may call
 * this — the plaintext must never be logged, audited or exported.
 */
export function decryptField(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("That stored value is not in the expected encrypted format.");
  }
  const [, iv, tag, ciphertext] = parts as [string, string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
