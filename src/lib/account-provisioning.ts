import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { auth } from "@/lib/auth";

/**
 * Public email/password signup is deliberately disabled for Appliance Desk.
 * Accounts are business records created by trusted server workflows instead.
 * This helper creates the Better Auth-compatible User + credential Account
 * rows without going through the public sign-up endpoint, so disabling
 * self-service signup does not force customer/staff/CI provisioning to use a
 * hidden back door through that endpoint.
 */
export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Used for invite-only accounts that immediately receive a password-reset
 * link. The value is never shown or reused; the recipient chooses the real
 * password through Better Auth's reset flow.
 */
export function generateUnusedAccountPassword(): string {
  return randomBytes(24).toString("base64url");
}

export type TrustedCredentialUserInput = {
  email: string;
  name: string | null;
  role: Role;
  password: string;
  emailVerified?: boolean;
};

/**
 * Must run inside the caller's business transaction. That lets account
 * creation commit atomically with the Customer/Staff record and its audit
 * evidence instead of leaving an orphan login when a later write fails.
 */
export async function createTrustedCredentialUserInTx(
  tx: Prisma.TransactionClient,
  input: TrustedCredentialUserInput,
) {
  const email = normalizeAccountEmail(input.email);
  const id = randomUUID();
  const context = await auth.$context;
  const passwordHash = await context.password.hash(input.password);

  return tx.user.create({
    data: {
      id,
      email,
      name: input.name,
      role: input.role,
      emailVerified: input.emailVerified ?? true,
      accounts: {
        create: {
          providerId: "credential",
          accountId: id,
          password: passwordHash,
        },
      },
    },
  });
}
