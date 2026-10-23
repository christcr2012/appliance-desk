import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { runStripeBooksNightly } from "@/domains/books/stripe-balance";

export const maxDuration = 60;

/** Only reads from Stripe; the saved provider evidence and journal stay private. */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 500 });
  if (!cronAuthorized(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  // Owner operational activation is distinct from published inactive engineering.
  if (process.env.BOOKS_STRIPE_SYNC_ENABLED !== "true")
    return NextResponse.json({ outcome: "PAUSED", reason: "Accounting provider sync awaits owner activation." });

  const result = await runAutomation({
    ruleKey: "books-nightly",
    budgetSeconds: 60,
    work: async () => {
      const answer = await runStripeBooksNightly();
      if (answer.sync.state === "NOT_INITIALIZED")
        throw new Error("Owner must initialize books before nightly reconciliation.");
      if (answer.clearing.state === "UNKNOWN") {
        // Any incomplete reconciliation, even without an explicit posting error,
        // is a failed daily obligation. Do not consume the daily success slot.
        throw new Error("Stripe clearing could not be verified; review opening balance, import coverage and pending Books sources.");
      }
      return { counts: {
        pages: answer.sync.pages,
        imported: answer.sync.transactions,
        posted: answer.posted,
        differences: answer.clearing.state === "DIFFERENCE" ? 1 : 0,
      } };
    },
  });
  return NextResponse.json({ ...result });
}
