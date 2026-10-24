// ACC-1: which sign-in library calls a team member may make straight from the browser.
// Pure rules (no database), so they are easy to test. Used by the guard in src/lib/auth.ts.
const TEAM_ROLES = ["OWNER", "ADMIN", "STAFF"];

/** Account changes that must go through the My account page so they are recorded and the person is told. */
const ACCOUNT_CHANGE_PATHS = new Set([
  "/change-email",
  "/change-password",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
]);

export const GUARDED_AUTH_PATHS: ReadonlySet<string> = ACCOUNT_CHANGE_PATHS;

export type AuthPathDecision = { allow: true } | { allow: false; message: string };

export function decideAccountAuthPath(input: {
  path: string;
  /** True when the call arrived as a web request; false when our own server code called the library directly. */
  viaHttp: boolean;
  role: string | null | undefined;
}): AuthPathDecision {
  if (!ACCOUNT_CHANGE_PATHS.has(input.path)) return { allow: true };
  const isTeam = TEAM_ROLES.includes(input.role ?? "");
  // Customers never change their sign-in email here: their customer record is matched on it.
  if (input.path === "/change-email" && !isTeam) {
    return { allow: false, message: "That change is not available for this account." };
  }
  if (isTeam && input.viaHttp) {
    return { allow: false, message: "Make this change on the My account page so it is recorded and you are notified." };
  }
  return { allow: true };
}
