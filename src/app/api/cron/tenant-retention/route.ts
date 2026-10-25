import { cronAuthorized } from "@/lib/cron-auth";
import { NextResponse } from "next/server";
import { runAutomation } from "@/domains/automation/runs";
import { eraseExpiredTenantPII } from "@/domains/customers/location-contacts";
import { runStoredFileCleanup } from "@/domains/stored-files/cleanup";
export const maxDuration = 60;
/**
 * Scheduled erasure of ended tenant identities, then the clean-up of stored files nobody needs any more (removed
 * receipt pages, photos taken off a request before sending). Never a communication job.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured." }, { status: 500 });
  if (!cronAuthorized(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const result = await runAutomation({
    ruleKey: "tenant-retention",
    budgetSeconds: 60,
    work: async () => ({ counts: { erased: await eraseExpiredTenantPII() } }),
  });
  // The file clean-up has its own record so a failure in one never hides the other.
  const cleanup = await runAutomation({
    ruleKey: "stored-file-cleanup",
    budgetSeconds: 60,
    work: async () => {
      const counts = await runStoredFileCleanup();
      // A file that could not be deleted after every try must not look like a good night: failing the run records a
      // system issue and shows "failing" on the automations page until a later run finishes cleanly.
      if (counts.failed > 0) {
        throw new Error(`${counts.failed} stored file${counts.failed === 1 ? "" : "s"} could not be deleted after several tries. They stay on the clean-up list marked as failed.`);
      }
      return { counts };
    },
  });
  return NextResponse.json({ ...result, storedFileCleanup: cleanup });
}
