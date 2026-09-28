"use server";

import { getServerSession, type Role } from "@/lib/session";

const ROLE_LANDING_PAGE: Record<Role, string> = {
  // "Today" (2026-09-28) — what's scheduled today plus anything stuck
  // needing attention (the exception inbox), so logging in lands
  // somewhere actionable instead of a page of stats. The stats
  // dashboard is still there, just one click away in the nav.
  OWNER: "/desk/today",
  ADMIN: "/desk/today",
  STAFF: "/desk/today",
  CUSTOMER: "/account",
};

/**
 * Only a same-site, in-app path is ever honored for `?next=`. This blocks
 * open-redirect attacks (e.g. `?next=https://evil.example`,
 * `?next=//evil.example`) — a bounced-back link should only ever be able to
 * send someone back into this app, never off of it.
 */
function isSafeNextPath(next: string | null): next is string {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  // Guards against a value like "/\evil.com", which some browsers treat as
  // protocol-relative.
  if (next.startsWith("/\\")) return false;
  return true;
}

/**
 * Called right after a successful sign-in (see login-form.tsx). Figures out
 * where this account should land: the role's normal home page, unless the
 * user was bounced to /login while trying to reach a specific page (a safe,
 * same-site `?next=` value), in which case that page wins instead.
 *
 * This is intentionally server-side: it reads the just-created session
 * directly rather than trusting anything the client claims about its own
 * role.
 */
export async function getPostLoginDestination(nextParam: string | null): Promise<string> {
  const session = await getServerSession();
  if (!session) {
    // Sign-in must have failed or the session cookie hasn't landed yet —
    // send back to /login rather than guessing.
    return "/login";
  }

  const role = (session.user as { role?: Role }).role ?? "CUSTOMER";

  if (isSafeNextPath(nextParam)) {
    return nextParam;
  }

  return ROLE_LANDING_PAGE[role] ?? "/account";
}
