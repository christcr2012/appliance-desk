import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { validateFeedbackSettings, type FeedbackSettings } from "./rules";

export { validateFeedbackSettings, type FeedbackSettings } from "./rules";

// MCP-10a owner settings (Settings › App feedback). Starting values: 3 pictures per report (enough for a few
// screenshots of one problem without storing a photo album) and 90 days to reopen a finished report (about one
// season, long enough to notice a fix didn't hold). Only the owner can change them; changes apply from then on.

export const RECOMMENDED_FEEDBACK_MAX_ATTACHMENTS = 3;
export const RECOMMENDED_FEEDBACK_REOPEN_DAYS = 90;

export async function getFeedbackSettings(): Promise<FeedbackSettings> {
  const row = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { feedbackMaxAttachments: true, feedbackReopenDays: true },
  });
  return {
    maxAttachments: row?.feedbackMaxAttachments ?? RECOMMENDED_FEEDBACK_MAX_ATTACHMENTS,
    reopenDays: row?.feedbackReopenDays ?? RECOMMENDED_FEEDBACK_REOPEN_DAYS,
  };
}

/** Owner-only, audited, compare-and-set (a change made in another tab is never silently overwritten). */
export async function saveFeedbackSettings(actorId: string, next: FeedbackSettings, expected: FeedbackSettings): Promise<void> {
  const value = validateFeedbackSettings(next);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: { id: "singleton", feedbackMaxAttachments: expected.maxAttachments, feedbackReopenDays: expected.reopenDays },
      data: { feedbackMaxAttachments: value.maxAttachments, feedbackReopenDays: value.reopenDays },
    });
    if (changed.count !== 1) throw new Error("This setting was changed in another session. Reload before saving.");
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "feedback.settings.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { feedbackMaxAttachments: expected.maxAttachments, feedbackReopenDays: expected.reopenDays },
        newValue: { feedbackMaxAttachments: value.maxAttachments, feedbackReopenDays: value.reopenDays },
      },
    });
  });
}
