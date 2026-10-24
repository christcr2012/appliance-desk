import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import type { TelecomSyncResource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAutomation } from "@/domains/automation/runs";
import { syncTelecomUsage } from "@/domains/messaging/telecom-sync";
import { telecomReportPeriods } from "@/domains/messaging/telecom-periods";

export const maxDuration = 60;
const DAY = 86_400_000;
const PAGES_PER_RUN = 8;

/**
 * Nightly read-only pull of what the phone company says we used and were charged.
 * It never sends a text or places a call, and it stays off until the owner turns it on.
 * It fetches exactly the two periods the spending report shows, and if a pull is not finished
 * it keeps the SAME dates the next night until it is, so it can never get stuck on a half-read window.
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
      const { current, previous } = telecomReportPeriods(new Date());
      const exclusiveEnd = (d: Date) => new Date(+d + DAY);
      const monthWindows = [previous, current].map((p) => ({ start: p.start, end: exclusiveEnd(p.end) }))
        .filter((w) => +w.end > +w.start);
      const spanning = { start: previous.start, end: exclusiveEnd(current.end) };
      let pages = 0, records = 0, unpriced = 0, busy = 0, unfinished = 0;

      for (const account of accounts) {
        const plan: Array<{ resource: TelecomSyncResource; windows: Array<{ start: Date; end: Date }> }> = [
          { resource: "USAGE", windows: monthWindows },
          { resource: "MESSAGES", windows: [spanning] },
          { resource: "CALLS", windows: [spanning] },
        ];
        for (const { resource, windows } of plan) {
          // A pull that was left half-read keeps its own dates until it is finished.
          const cursor = await prisma.telecomSyncCursor.findUnique({
            where: { accountId_resource: { accountId: account.id, resource } },
            select: { nextPageToken: true, windowStart: true, windowEnd: true },
          });
          const todo = cursor?.nextPageToken ? [{ start: cursor.windowStart, end: cursor.windowEnd }, ...windows] : windows;
          for (const w of todo) {
            try {
              const r = await syncTelecomUsage({ accountId: account.id, resource, windowStart: w.start, windowEnd: w.end, maxPages: PAGES_PER_RUN });
              pages += r.pages; records += r.records; unpriced += r.unknownPrices;
              if (!r.completed) { unfinished++; break; } // pick up exactly here tomorrow
            } catch (error) {
              if (error instanceof Error && error.message === "SYNC_BUSY") { busy++; break; }
              throw error;
            }
          }
        }
      }
      return { counts: { pages, records, unpriced, busy, unfinished } };
    },
  });
  return NextResponse.json({ ...result });
}
