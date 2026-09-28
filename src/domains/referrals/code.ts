// Referral codes (Task #68, docs/DECISIONS.md 2026-09-28) — pure, no
// database access, same split as src/domains/leads' generateUnusedAccountPassword:
// the random-generation logic lives here so it's trivially unit-testable,
// while the "keep retrying until it's actually unused" loop (which needs
// a real database lookup) lives in ./index.ts.

// Deliberately excludes visually-ambiguous characters (0/O, 1/I/L) — this
// code gets read aloud, texted, and typed in by hand on the public lead
// form, so every character needs to be unambiguous at a glance.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** A random 6-character referral code, e.g. "7K4MXQ". Not guaranteed
 * unique on its own — see generateUniqueReferralCode in ./index.ts. */
export function generateReferralCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Normalizes a code exactly the way it's compared at lookup time
 * (uppercased, trimmed) — used both when matching a lead's typed-in
 * code against a customer's own, and nowhere else, so the two can never
 * drift apart on what "the same code" means. */
export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}
