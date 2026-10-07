import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { isTwoFactorRequired } from "@/domains/security/two-factor-policy";

export type Role = "OWNER" | "ADMIN" | "STAFF" | "CUSTOMER";

const TWO_FACTOR_SETUP_PATH = "/desk/security/setup";

const readTwoFactorRequiredRoles = cache(async () => {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { twoFactorRequiredRoles: true },
  });
  return settings?.twoFactorRequiredRoles;
});

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

/**
 * Redirects to /login if signed out, or to / if signed in but the wrong
 * role. This is the server-side gate for every /desk/** route — never rely
 * on hiding a nav link instead of calling this.
 */
export async function requireRole(...roles: Role[]) {
  const session = await requireSession();
  const role = session.user.role;
  if (!roles.includes(role)) {
    redirect("/");
  }

  if (isTwoFactorRequired(role, await readTwoFactorRequiredRoles())) {
    const enrolled =
      (session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled === true;
    const pathname = (await headers()).get("x-appliance-pathname");
    if (!enrolled && pathname !== TWO_FACTOR_SETUP_PATH) {
      redirect(TWO_FACTOR_SETUP_PATH);
    }
  }

  return session;
}
