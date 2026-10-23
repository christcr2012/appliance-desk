import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { createDueRecurringExpenses } from "@/domains/books/expenses";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 500 });
  if (!cronAuthorized(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const result = await runAutomation({
    ruleKey: "expense-drafts", budgetSeconds: 60,
    work: async () => ({ counts: { drafts: await createDueRecurringExpenses() } }),
  });
  return NextResponse.json(result);
}
