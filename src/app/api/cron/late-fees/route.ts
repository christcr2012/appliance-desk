import { NextResponse } from "next/server";
import { applyLateFees, sendLateFeeDigestToChris } from "@/domains/billing";

// Fired once a day by Vercel Cron (see vercel.json's schedule) — applies
// automated late fees (src/domains/billing/late-fees.ts) and emails Chris
// a digest if anything was applied. Same CRON_SECRET bearer-token check
// as /api/cron/billing-reminders; harmless to run twice in a day since
// Invoice.lateFeeCents === 0 is the idempotency guard.
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing to run late-fee automation.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const applied = await applyLateFees();
  await sendLateFeeDigestToChris(applied);

  return NextResponse.json({ applied: applied.length });
}
