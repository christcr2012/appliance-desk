import { NextResponse } from "next/server";

/** Liveness only: no database, private settings or secret values. */
export function GET() {
  return NextResponse.json({ ok: true, revision: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown" },
    { status: 200, headers: { "Cache-Control": "no-store" } });
}
