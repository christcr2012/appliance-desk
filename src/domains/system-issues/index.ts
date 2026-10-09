import { prisma } from "@/lib/prisma";
import { renderSystemIssue } from "./render";
import type { SystemIssueInput, SystemIssueResolution } from "./types";

export type { SystemIssueInput, SystemIssueResolution } from "./types";

function logFailure(code: string): void {
  // Fixed diagnostic codes only; never log the original error/provider response.
  console.error("[system-issues]", code);
}

/** Best-effort out-of-band issue recording; never fails a business transaction. */
export async function recordSystemIssue(input: SystemIssueInput): Promise<void> {
  try {
    const issue = renderSystemIssue(input);
    if (issue.watch) {
      const match = await prisma.officialSourceWatch.findFirst({
        where: { id: issue.watch.id, url: issue.watch.url, active: true },
        select: { id: true },
      });
      if (!match) throw new Error("Unrecognized official page");
    }
    await prisma.systemIssue.upsert({
      where: { fingerprint: issue.fingerprint },
      create: {
        fingerprint: issue.fingerprint, kind: issue.kind, severity: issue.severity,
        summary: issue.summary, detail: issue.detail,
      },
      update: {
        severity: issue.severity, summary: issue.summary, detail: issue.detail,
        occurrences: { increment: 1 }, version: { increment: 1 },
        lastSeenAt: new Date(), status: "OPEN", resolvedAt: null, resolvedReason: null,
      },
    });
  } catch {
    logFailure("SYSTEM_ISSUE_RECORD_FAILED");
  }
}

/** A confirmed source success resolves the source fingerprint, not unrelated issues. */
export async function resolveSystemIssue(
  fingerprint: string, reason: SystemIssueResolution,
): Promise<void> {
  try {
    if (typeof fingerprint !== "string" || !/^[a-zA-Z0-9_.:-]{1,240}$/.test(fingerprint)) {
      throw new Error("Invalid issue fingerprint");
    }
    if (!["SOURCE_SUCCEEDED", "NO_STUCK_ITEMS", "OWNER_REVIEWED"].includes(reason)) {
      throw new Error("Invalid issue resolution");
    }
    await prisma.systemIssue.updateMany({
      where: { fingerprint, status: { not: "RESOLVED" } },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedReason: reason, version: { increment: 1 } },
    });
  } catch {
    logFailure("SYSTEM_ISSUE_RESOLVE_FAILED");
  }
}
