import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

export type Role = "OWNER" | "ADMIN" | "CUSTOMER";

/**
 * Reads the current session on the server. Cached per-request so calling
 * this from a layout AND a page in the same request only hits the auth
 * backend once.
 */
export const getServerSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Redirects to /login if nobody is signed in. Use in every protected page/layout. */
export async function requireSession() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
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
  const role = (session.user as { role?: Role }).role ?? "CUSTOMER";
  if (!roles.includes(role)) {
    redirect("/");
  }
  return session;
}
