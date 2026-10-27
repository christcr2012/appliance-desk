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
//
// VAULT-2: the logins vault uses the SAME format with a SEPARATE key
// (VAULT_ENCRYPTION_KEY), so a vault value can never be opened with the
// compliance key or the other way round. The core below is parameterised by
// env name; the two trios of exports are the only doors.

const VERSION = "v1";

type FieldCrypto = {
  hasKey: () => boolean;
  encrypt: (plain: string) => string;
  decrypt: (stored: string) => string;
};

function fieldCrypto(envName: string, label: string): FieldCrypto {
  function readKey(): Buffer | null {
    const encoded = process.env[envName];
    if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;
    const key = Buffer.from(encoded, "base64");
    return key.length === 32 ? key : null;
  }

  function getKey(): Buffer {
    const key = readKey();
    if (!key) {
      throw new Error(`The ${label} encryption key is not set, so this value can't be stored safely.`);
    }
    return key;
  }

  return {
    hasKey: () => readKey() !== null,

    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
      const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
    },

    decrypt(stored: string): string {
      const parts = stored.split(":");
      if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error("That stored value is not in the expected encrypted format.");
      }
      const [, iv, tag, ciphertext] = parts as [string, string, string, string];
      const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
    },
  };
}

const compliance = fieldCrypto("COMPLIANCE_ENCRYPTION_KEY", "compliance");
const vault = fieldCrypto("VAULT_ENCRYPTION_KEY", "vault");

/** True when a valid compliance encryption key is configured. */
export function hasFieldCryptoKey(): boolean {
  return compliance.hasKey();
}

/** Encrypts one short field value. The result is safe to store in the database. */
export function encryptField(plain: string): string {
  return compliance.encrypt(plain);
}

/**
 * Decrypts a value written by encryptField. Only filing preparation may call
 * this — the plaintext must never be logged, audited or exported.
 */
export function decryptField(stored: string): string {
  return compliance.decrypt(stored);
}

/** True when a valid vault encryption key is configured. */
export function hasVaultCryptoKey(): boolean {
  return vault.hasKey();
}

/** Encrypts one vault secret (a username, password or note) with the vault key. */
export function encryptVaultField(plain: string): string {
  return vault.encrypt(plain);
}

/**
 * Decrypts a value written by encryptVaultField. Only the vault's reveal path
 * (unlock-gated, audited, one field at a time) and the emergency export may
 * call this — the plaintext must never be logged or audited.
 */
export function decryptVaultField(stored: string): string {
  return vault.decrypt(stored);
}
