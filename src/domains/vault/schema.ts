import { z } from "zod";

/**
 * VAULT-2: what the vault screens may submit. Secret fields are write-only:
 * an absent key leaves the stored value alone, an empty string clears it,
 * and any other string replaces it (encrypted in the domain, never echoed).
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const secretText = (max: number) => z.string().max(max).optional();

export const vaultCredentialInputSchema = z.object({
  title: z.string().trim().min(2, "Give the login a name.").max(120),
  url: optionalText(500).refine(
    (v) => v == null || /^https:\/\/[^\s]+$/.test(v),
    "A website address must start with https://",
  ),
  username: secretText(300),
  password: secretText(1000),
  notes: secretText(4000),
  totpHint: optionalText(120),
  rotateEveryMonths: z
    .union([z.number().int().min(1).max(36), z.null()])
    .optional()
    .transform((v) => v ?? null),
});

export type VaultCredentialInput = z.infer<typeof vaultCredentialInputSchema>;

/** True when the input carries a secret change (set or clear) — those need an unlock. */
export function inputTouchesSecrets(input: VaultCredentialInput): boolean {
  return input.username !== undefined || input.password !== undefined || input.notes !== undefined;
}
