import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { TimelineItem } from "@/components/kit/timeline";
import type { Tone } from "@/components/kit/types";

/**
 * AR-5 section 6: the visit record's Activity tab — the job's own audit entries in plain
 * words, newest first. Unknown action names are skipped rather than shown raw. No money
 * amounts ever appear here, so every role sees the same list.
 */
const TITLES: Record<string, { title: string; tone: Tone }> = {
  "job.create": { title: "Visit created", tone: "neutral" },
  "job.schedule": { title: "Time or person changed", tone: "neutral" },
  "job.status": { title: "Visit status changed", tone: "info" },
  "job.checklist.update": { title: "Checklist updated", tone: "neutral" },
  "job.photo.add": { title: "Photo added", tone: "neutral" },
  "job.complete": { title: "Visit finished", tone: "good" },
  "job.pickup_billing": { title: "Pickup billing recorded", tone: "neutral" },
};

export async function getVisitTimeline(jobId: string): Promise<TimelineItem[]> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "Job", entityId: jobId },
    select: { id: true, action: true, createdAt: true, userId: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  const known = rows.filter((row) => TITLES[row.action]);
  const userIds = [...new Set(known.map((row) => row.userId).filter(Boolean))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const names = new Map(users.map((user) => [user.id, user.name ?? user.email]));
  return known.map((row) => ({
    id: row.id,
    at: row.createdAt,
    title: TITLES[row.action]!.title,
    tone: TITLES[row.action]!.tone,
    actor: row.userId ? (names.get(row.userId) ?? "automatic") : "automatic",
  }));
}
