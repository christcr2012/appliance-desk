/**
 * CU-1 (AR-4c): the normalized phone key every customer write maintains, so
 * phone search compares exact digits instead of whatever punctuation the
 * person typed — the LD-1 leadContactKeys pattern, for customers.
 *
 * - phoneDigits: digits only ("(970) 555-0134" -> "9705550134"); null when
 *   the phone has no digits at all.
 *
 * Callers spread the result into the same `customer.create` / `customer.update`
 * data object that sets `phone`. The grep test in tests/customer-keys.test.ts
 * fails the build if a customer write sets `phone` without this key.
 */
export function customerContactKeys(input: {
  phone?: string | null;
}): { phoneDigits: string | null } {
  const digits = (input.phone ?? "").replace(/\D/g, "");
  return { phoneDigits: digits === "" ? null : digits };
}
