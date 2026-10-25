import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed "what you previewed is what gets applied" tokens (bank-statement import, Decisions & reviews answers).
 * A token is base64url(JSON claims) + "." + HMAC-SHA256 with the app's sign-in secret. The caller checks the claims
 * (who, what hash, when it expires); this file only signs, verifies the signature in constant time and decodes.
 * `label` names the feature in the error messages, e.g. "Bank preview".
 */
export type PreviewTokenErrors = { label: string; error: (message: string) => Error };

function tokenSecret(errors: PreviewTokenErrors) {
  const value = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw errors.error(`${errors.label} signing is not securely configured.`);
  return value;
}

function sign(payload: string, errors: PreviewTokenErrors) {
  return createHmac("sha256", tokenSecret(errors)).update(payload).digest("base64url");
}

export function previewToken(claim: object, errors: PreviewTokenErrors): string {
  const value = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return value + "." + sign(value, errors);
}

/** Checks the signature and decodes the claims. The caller must still validate every claim it relies on. */
export function verifyToken(token: string, errors: PreviewTokenErrors): unknown {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra || payload.length > 3000) throw errors.error(`${errors.label} token is invalid.`);
  const signature = Buffer.from(sig, "base64url"), expected = Buffer.from(sign(payload, errors), "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
    throw errors.error(`${errors.label} token is not valid.`);
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    throw errors.error(`${errors.label} token cannot be read.`);
  }
}
