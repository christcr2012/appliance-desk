import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Coarse, fast gate: is *someone* signed in? This only checks for the
// session cookie (no DB call, safe to run on every request at the edge).
// The real authorization check — is this the RIGHT someone, with the
// right role, for the right customer's own data — happens again on the
// server in every /desk and /account page/action via requireRole() /
// requireSession() in src/lib/session.ts. Never trust this proxy alone
// for anything sensitive.
//
// This file used to be middleware.ts — Next.js 16 renamed the file
// convention to proxy.ts (same idea, same escape hatches, new name).
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  const isProtected =
    request.nextUrl.pathname.startsWith("/desk") ||
    request.nextUrl.pathname.startsWith("/account");

  if (isProtected && !sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/desk/:path*", "/account/:path*"],
};
