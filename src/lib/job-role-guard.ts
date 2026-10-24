import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { jobRoleAllowsPath } from "@/domains/team/job-role-rules";

// ACC-5: the server-side screen check for job roles. A job role only narrows an access level: people without one
// (and every owner) are unaffected. Pages and server actions both pass through here (layout + requireRole), so hiding
// a menu entry is never the protection. Server actions post to the address of the page they were used on, which the
// proxy stamps on the request (client-supplied values are overwritten).

export class JobRoleScreenError extends Error {
  constructor() {
    super("Your job role does not include this screen. Ask the owner if you need it.");
    this.name = "JobRoleScreenError";
  }
}

const screensFor = cache(async (userId: string) => {
  const { screensForUser } = await import("@/domains/team/job-roles");
  return screensForUser(userId);
});

/** null = no limit (owner, customer, or no job role). */
export async function jobRoleScreens(userId: string, role: string): Promise<string[] | null> {
  if (role !== "STAFF" && role !== "ADMIN") return null;
  return screensFor(userId);
}

/** Redirects a page request (or throws for a server action) when the person's job role does not include the screen. */
export async function enforceJobRoleScreen(userId: string, role: string) {
  const screens = await jobRoleScreens(userId, role);
  if (screens === null) return;
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-appliance-pathname");
  // Only desk screens are screens (account pages and the like are not narrowed by a job role).
  if (!pathname || !pathname.startsWith("/desk")) return;
  if (jobRoleAllowsPath(screens, pathname)) return;
  if (requestHeaders.get("next-action")) throw new JobRoleScreenError();
  redirect("/desk/today?screen=not-in-job-role");
}
