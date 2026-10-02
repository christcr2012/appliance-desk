import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requestInvitationEmail } from "@/lib/password-email";
import {
  createTrustedCredentialUserInTx,
  generateUnusedAccountPassword,
  normalizeAccountEmail,
} from "@/lib/account-provisioning";

// ---------------------------------------------------------------------------
// Staff permissions framework (Task #66, docs/DECISIONS.md 2026-09-28) —
// a STAFF login role: day-to-day operational access (jobs, dispatch,
// customers, inventory, maintenance), but not business financials or
// settings. Restricted pages enforce their roles on the server.
// ---------------------------------------------------------------------------

export async function getStaffAccounts() {
  return prisma.user.findMany({
    where: { role: "STAFF" },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      archivedAt: true,
    },
  });
}

/**
 * Creates a STAFF login through the same trusted server-side credential
 * provisioning primitive used for customers. User creation and audit evidence
 * commit together; the activation email is attempted only after that durable
 * transaction succeeds.
 */
export async function createStaffAccount(
  actingUserId: string,
  input: { name: string; email: string },
) {
  const email = normalizeAccountEmail(input.email);

  const account = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error(`${email} is already in use by another account.`);
    }

    const created = await createTrustedCredentialUserInTx(tx, {
      email,
      name: input.name,
      role: "STAFF",
      password: generateUnusedAccountPassword(),
    });

    await tx.auditLog.create({
      data: {
        userId: actingUserId,
        action: "staff.create",
        entityType: "User",
        entityId: created.id,
        newValue: { email, name: input.name },
      },
    });

    return created;
  });

  const activationEmailSent = await resendStaffActivationEmail(email);
  return { account, activationEmailSent };
}

export async function resendStaffActivationEmail(email: string): Promise<boolean> {
  return requestInvitationEmail(normalizeAccountEmail(email), () =>
    auth.api.requestPasswordReset({
      body: { email: normalizeAccountEmail(email), redirectTo: "/reset-password" },
    }),
  );
}

/** Immediately ends a staff member's access: signs them out of every
 * device and marks the account so requireSession() refuses it. */
export async function deactivateStaffAccount(
  actingUserId: string,
  staffUserId: string,
) {
  const staff = await prisma.user.findUniqueOrThrow({ where: { id: staffUserId } });
  if (staff.role !== "STAFF") {
    throw new Error("That account isn't a staff login.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: staffUserId },
      data: { archivedAt: new Date() },
    });
    await tx.session.deleteMany({ where: { userId: staffUserId } });
    await tx.auditLog.create({
      data: {
        userId: actingUserId,
        action: "staff.deactivate",
        entityType: "User",
        entityId: staffUserId,
      },
    });
  });
}

/** Restores a previously-removed staff login. Their old password still
 * works (nothing about it changed) — no new activation email needed. */
export async function reactivateStaffAccount(
  actingUserId: string,
  staffUserId: string,
) {
  const staff = await prisma.user.findUniqueOrThrow({ where: { id: staffUserId } });
  if (staff.role !== "STAFF") {
    throw new Error("That account isn't a staff login.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: staffUserId }, data: { archivedAt: null } });
    await tx.auditLog.create({
      data: {
        userId: actingUserId,
        action: "staff.reactivate",
        entityType: "User",
        entityId: staffUserId,
      },
    });
  });
}
