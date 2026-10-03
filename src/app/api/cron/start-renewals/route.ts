import { NextResponse } from "next/server";
import { startDueRenewals } from "@/domains/agreements/renewal-start";

// Fired once a day by Vercel Cron (see vercel.json). Starts every signed
// renewal whose start date has arrived: the renewal becomes the active rental
// and the rental it renews ends, in one step (src/domains/agreements/
// renewal-start.ts). Safe to run twice: a renewal that already started is no
// longer SCHEDULED. Same CRON_SECRET bearer-token check as the other cron jobs.
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to start renewals.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await startDueRenewals();
  if (result.blocked.length > 0) {
    console.error("[cron] Renewals that could not start:", result.blocked);
  }
  return NextResponse.json({ started: result.started, blocked: result.blocked.length });
}
