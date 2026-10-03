import { NextResponse } from "next/server";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";

/** Daily recovery pass for durable Stripe/provider intents. */
export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.error("[cron] CRON_SECRET is not set — refusing billing reconciliation.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await finishPendingProviderOperations();
  return NextResponse.json(result);
}
