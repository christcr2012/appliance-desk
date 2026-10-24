import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAutomation } from "@/domains/automation/runs";
import { syncTelecomUsage } from "@/domains/messaging/telecom-sync";

export const maxDuration = 60;

const RESOURCES = ["USAGE", "MESSAGES", "CALLS"] as const;
const WINDOW_DAYS = 35;

/**
 * Nightly read-only pull of what the phone company says we used and were charged.
 * It never sends a text or places a call, and it stays off until the owner turns it on.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 500 });
  if (!cronAuthorized(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (process.env.TELECOM_SYNC_ENABLED !== "true")
    return NextResponse.json({ outcome: "PAUSED", reason: "Phone-company usage sync awaits owner activation." });

  const result = await runAutomation({
    ruleKey: "telecom-sync",
    budgetSeconds: 60,
    work: async () => {
      const accounts = await prisma.telecomAccount.findMany({
        where: { environment: "PRODUCTION", provider: { equals: "twilio", mode: "insensitive" } },
        select: { id: true },
        take: 5,
      });
      if (accounts.length === 0) throw new Error("No phone-company account is set up for production.");
      // Whole-day window ending today (UTC) so a repeat run the same day resumes the same checkpoint.
      const end = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
      const start = new Date(+end - WINDOW_DAYS * 86_400_000);
      let pages = 0, records = 0, unpriced = 0, busy = 0;
      for (const account of accounts) {
        for (const resource of RESOURCES) {
          try {
            const r = await syncTelecomUsage({ accountId: account.id, resource, windowStart: start, windowEnd: end });
            pages += r.pages; records += r.records; unpriced += r.unknownPrices;
          } catch (error) {
            // Another run holds this checkpoint; the next run picks it up. Anything else is a real failure.
            if (error instanceof Error && error.message === "SYNC_BUSY") { busy++; continue; }
            throw error;
          }
        }
      }
      return { counts: { pages, records, unpriced, busy } };
    },
  });
  return NextResponse.json({ ...result });
}
