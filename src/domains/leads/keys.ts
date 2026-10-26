/**
 * LD-1: the normalized contact keys every lead write maintains, so duplicate
 * checks and phone search compare exact values instead of whatever
 * punctuation or capitalisation the visitor typed.
 *
 * - phoneDigits: digits only ("(970) 555-0134" -> "9705550134"); null when
 *   the phone has no digits at all.
 * - emailLower: trimmed lower-case email; null when blank.
 *
 * Callers spread the result into the same `lead.create` / `lead.update` /
 * `lead.updateMany` data object that sets `phone` / `email`. The grep test in
 * tests/lead-keys.test.ts fails the build if a lead write sets either field
 * without these keys.
 */
export function leadContactKeys(input: {
  phone?: string | null;
  email?: string | null;
}): { phoneDigits: string | null; emailLower: string | null } {
  const digits = (input.phone ?? "").replace(/\D/g, "");
  const email = (input.email ?? "").trim().toLowerCase();
  return {
    phoneDigits: digits === "" ? null : digits,
    emailLower: email === "" ? null : email,
  };
}
