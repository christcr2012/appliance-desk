import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { generateUnusedAccountPassword } from "@/domains/leads";

// ---------------------------------------------------------------------------
// Staff permissions framework (Task #66, docs/DECISIONS.md 2026-09-28) —
// a STAFF login role: day-to-day operational access (jobs, dispatch,
// customers, inventory, maintenance), but not business financials
// (Dashboard, Billing, Revenue, Reports, Growth) or Settings. Those pages
// each call requireRole("OWNER", "ADMIN") directly — never rely on a
// hidden nav link alone (see src/lib/session.ts's own comment).
//
// Chris didn't have specific roles in mind yet (e.g. a separate "driver"
// vs "office" tier) — this is deliberately one role, built so it's safe
// to hand to a new hire the day he needs to, not a full role-editor.
// ---------------------------------------------------------------------------

export async function getStaffAccounts() {
  return prisma.user.findMany({
    where: { role: "STAFF" },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, email: true, createdAt: true, archivedAt: true },
  });
}

/**
 * Creates a new STAFF login and emails them the same "set your password"
 * link customer accounts activate with (see
 * src/domains/leads' sendCustomerActivationEmail — same mechanism,
 * reimplemented here rather than importing a customer-named helper into
 * an unrelated domain). Chris never learns or relays the account's
 * password, same as a customer's.
 */
export async function createStaffAccount(
  actingUserId: string,
  input: { name: string; email: string },
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new Error(`${input.email} is already in use by another account.`);
  }

  const signUp = await auth.api.signUpEmail({
    body: { email: input.email, password: generateUnusedAccountPassword(), name: input.name },
  });
  const account = await prisma.user.update({
    where: { id: signUp.user.id },
    data: { role: "STAFF" },
  });

  let activationEmailSent = false;
  try {
    await auth.api.requestPasswordReset({
      body: { email: input.email, redirectTo: "/reset-password" },
    });
    activationEmailSent = true;
  } catch (error) {
    console.error("[staff] Failed to send staff activation email", error);
  }

  await prisma.auditLog.create({
    data: {
      userId: actingUserId,
      action: "staff.create",
      entityType: "User",
      entityId: account.id,
      newValue: { email: input.email, name: input.name },
    },
  });

  return { account, activationEmailSent };
}

export async function resendStaffActivationEmail(email: string): Promise<boolean> {
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    return true;
  } catch (error) {
    console.error("[staff] Failed to resend staff activation email", error);
    return false;
  }
}

/** Immediately ends a staff member's access: signs them out of every
 * device right now (deletes their live sessions) and marks the account
 * so `requireSession()` refuses it even after a fresh sign-in — see
 * that function's own comment for how `archivedAt` rides along on the
 * session without an extra database call on every page. The User row
 * itself is kept, not deleted, so past audit-log entries and job
 * history still point to a real name. */
export async function deactivateStaffAccount(actingUserId: string, staffUserId: string) {
  const staff = await prisma.user.findUniqueOrThrow({ where: { id: staffUserId } });
  if (staff.role !== "STAFF") {
    throw new Error("That account isn't a staff login.");
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: staffUserId }, data: { archivedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: staffUserId } }),
  ]);

  await prisma.auditLog.create({
    data: {
      userId: actingUserId,
      action: "staff.deactivate",
      entityType: "User",
      entityId: staffUserId,
    },
  });
}

/** Restores a previously-removed staff login. Their old password still
 * works (nothing about it changed) — no new activation email needed. */
export async function reactivateStaffAccount(actingUserId: string, staffUserId: string) {
  const staff = await prisma.user.findUniqueOrThrow({ where: { id: staffUserId } });
  if (staff.role !== "STAFF") {
    throw new Error("That account isn't a staff login.");
  }

  await prisma.user.update({ where: { id: staffUserId }, data: { archivedAt: null } });

  await prisma.auditLog.create({
    data: {
      userId: actingUserId,
      action: "staff.reactivate",
      entityType: "User",
      entityId: staffUserId,
    },
  });
}
