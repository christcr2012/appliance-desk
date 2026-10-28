import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { isRateLimited } from "@/lib/rate-limit";
import { twoFactorEnrollmentRequired } from "@/domains/security/two-factor";

// DEC-1b: the front door for the Decisions & reviews file routes. The decisions domain re-checks the role inside its
// own transaction; this only turns away the wrong person early and plainly. Missing or unknown role data denies.
export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

type Guarded = { ok: true; userId: string; role: "OWNER" | "ADMIN" | "ACCOUNTANT" } | { ok: false; response: NextResponse };

export async function guardDecisionRequest(
  request: Request, roles: readonly ("OWNER" | "ADMIN" | "ACCOUNTANT")[], opts: { write?: boolean } = {},
): Promise<Guarded> {
  const session = await getServerSession();
  const user = session?.user as { id?: unknown; role?: unknown; archivedAt?: unknown } | undefined;
  if (!user || typeof user.id !== "string" || user.archivedAt !== null) {
    return { ok: false, response: jsonError("Not signed in.", 401) };
  }
  const role = user.role;
  // ACCT-1: an accountant may pass the front door only where a route names the role (the professional-answer
  // route); the decisions domain then restricts them to CPA-audience questions. Every other route keeps
  // refusing them by not naming the role.
  if (role !== "OWNER" && role !== "ADMIN" && role !== "ACCOUNTANT") return { ok: false, response: jsonError("Only the owner can do that.", 403) };
  if (!roles.includes(role as "OWNER" | "ADMIN" | "ACCOUNTANT")) return { ok: false, response: jsonError("Only the owner can do that.", 403) };
  if (await twoFactorEnrollmentRequired(user.id, role)) {
    return { ok: false, response: jsonError("Set up two-step login first.", 403) };
  }
  if (opts.write) {
    // A form on another site must not be able to post here with the owner's cookies.
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return { ok: false, response: jsonError("Not permitted.", 403) };
    if (await isRateLimited(`decision-files:${user.id}`, { max: 30, windowMs: 10 * 60 * 1000 })) {
      return { ok: false, response: jsonError("Too many uploads in a short time. Please wait a few minutes.", 429) };
    }
  }
  return { ok: true, userId: user.id, role };
}
