import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// Content key is never stored in the database, audit log or repository.
// Invalid/missing credentials fail closed, not by silently persisting plaintext.
function getKey(): Buffer {
  const encoded = process.env.COMMUNICATION_CONTENT_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("Communication content encryption is not configured.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("Communication content encryption is not configured.");
  }
  return key;
}

export function hashCommunicationContent(value: string): string {
  return createHmac("sha256", getKey()).update(value, "utf8").digest("hex");
}

export function encryptCommunicationContent(plainText: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const content = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"),
    content.toString("base64")].join(":");
}

// Only authenticated server-side callers with access to the encryption key can
// reveal the private immutable content. The inbox enforces actor scope in L6B.
export function decryptCommunicationContent(stored: string): string {
  const [version, iv, tag, payload, extra] = stored.split(":");
  if (version !== "v1" || extra !== undefined || !iv || !tag || !payload) {
    throw new Error("Communication ciphertext format is invalid.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
}
