import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { twoFactorEnrollmentRequired } from "@/domains/security/two-factor";

export type Role = "OWNER" | "ADMIN" | "STAFF" | "CUSTOMER";

function isRole(value: unknown): value is Role {
  return value === "OWNER" || value === "ADMIN" || value === "STAFF" || value === "CUSTOMER";
}

/**
 * Reads the current session on the server. Cached per-request so calling
 * this from a layout AND a page in the same request only hits the auth
 * backend once.
 */
const readValidatedSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;
  if (!user || typeof user.id !== "string" || !user.id.trim() || !isRole(user.role)) {
    return null;
  }
  // Null means active. Missing state must not be interpreted as active if
  // the auth provider's payload changes or loses this additional field.
  if (user.archivedAt === undefined) return null;
  return { ...session, user: { ...user, role: user.role } };
});

/** Direct session readers (including server actions and upload routes)
 * receive only active, validated identities; they do not rely on a layout
 * having run requireSession first. */
export const getServerSession = cache(async () => {
  const session = await readValidatedSession();
  return session?.user.archivedAt === null ? session : null;
});

/** Redirects to /login if nobody is signed in, or if the account has
 * been deactivated (User.archivedAt set — see src/domains/staff's
 * "remove access" action). `archivedAt` rides along on the session
 * automatically (see src/lib/auth.ts's user.additionalFields), so this
 * needs no extra database call. A deactivated account keeps existing
 * as a User row (audit log entries still point somewhere real) but can
 * never sign in or use an existing session again. Use in every
 * protected page/layout. */
export async function requireSession() {
  const session = await readValidatedSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.archivedAt !== null) {
    redirect("/login?deactivated=1");
  }
  return session;
}

async function requireAllowedRole(roles: Role[]) {
  const session = await requireSession();
  const role = session.user.role;
  if (!roles.includes(role)) {
    redirect("/");
  }
  return session;
}

export class TwoFactorEnrollmentRequiredError extends Error {
  constructor() {
    super("Two-step login setup is required before this action can continue.");
    this.name = "TwoFactorEnrollmentRequiredError";
  }
}

/**
 * The setup page/actions are the only desk surface allowed before enrollment.
 * Never use this helper for ordinary pages or business actions.
 */
export async function requireRoleForTwoFactorSetup(...roles: Role[]) {
  return requireAllowedRole(roles);
}

export async function enforceTwoFactorForDeskPage(
  session: Awaited<ReturnType<typeof requireSession>>,
) {
  if (
    await twoFactorEnrollmentRequired(
      session.user.id,
      session.user.role,
    )
  ) {
    redirect("/desk/security/setup");
  }
}

/**
 * Server-side role + two-factor gate used by ordinary desk pages/actions.
 * Server actions fail closed with an error instead of relying on a page
 * redirect; setup actions use requireRoleForTwoFactorSetup explicitly.
 */
export async function requireRole(...roles: Role[]) {
  const session = await requireAllowedRole(roles);
  if (
    await twoFactorEnrollmentRequired(
      session.user.id,
      session.user.role,
    )
  ) {
    const requestHeaders = await headers();
    if (requestHeaders.get("next-action")) {
      throw new TwoFactorEnrollmentRequiredError();
    }
    redirect("/desk/security/setup");
  }
  return session;
}
