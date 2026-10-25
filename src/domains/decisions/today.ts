import { prisma } from "@/lib/prisma";
import { reportBackgroundError } from "@/lib/report-error";
import { addBusinessDays, businessDateFromKey, businessDateKey, businessDaysBetween } from "@/lib/business-date";
import { EMPTY_PREFERENCES, getWorkspace } from "@/domains/workspace";
import { listDecisions } from "./index";

/**
 * The "Decisions waiting" card on Today (DEC-1b, spec section 6): owner only, low priority, shown at most one day in
 * seven. A true blocker is never filed in Decisions & reviews (AGENTS section 1), so this card is never urgent.
 * The day it was last shown is kept in the owner's own workspace preferences (O-7).
 */
export const DECISIONS_CARD_EVERY_DAYS = 7;

/** Pure: show on the day it was last shown (so a reload doesn't hide it) or once a week has passed. */
export function decisionsCardDue(lastShownOn: string | undefined, todayKey: string): boolean {
  if (!lastShownOn) return true;
  if (lastShownOn === todayKey) return true;
  const last = businessDateFromKey(lastShownOn);
  const today = businessDateFromKey(todayKey);
  if (!last || !today) return true;
  return businessDaysBetween(last, today) >= DECISIONS_CARD_EVERY_DAYS || last.getTime() > today.getTime();
}

/** The next day the card may show again, as YYYY-MM-DD (used in tests and the card's tip). */
export function nextDecisionsCardDay(shownOn: string): string {
  const day = businessDateFromKey(shownOn);
  return day ? businessDateKey(addBusinessDays(day, DECISIONS_CARD_EVERY_DAYS)) : shownOn;
}

/** Remember today as the day the card was shown. Not a settings change: the workspace version is not bumped. */
async function noteShown(userId: string, todayKey: string) {
  const empty = JSON.stringify({ ...EMPTY_PREFERENCES, decisionsCardShownOn: todayKey });
  await prisma.$executeRaw`
    INSERT INTO "OwnerWorkspacePreference" ("userId", "version", "preferences", "updatedAt")
    VALUES (${userId}, 1, ${empty}::jsonb, now())
    ON CONFLICT ("userId") DO UPDATE
      SET "preferences" = jsonb_set(COALESCE("OwnerWorkspacePreference"."preferences", '{}'::jsonb),
        '{decisionsCardShownOn}', to_jsonb(${todayKey}::text), true)`;
}

/** The number of decisions waiting when the card should show today, otherwise null. Never throws (Today must load). */
export async function decisionsTodayCount(owner: { id: string; role: string }, now = new Date()): Promise<number | null> {
  if (owner.role !== "OWNER") return null;
  try {
    const todayKey = businessDateKey(now);
    const workspace = await getWorkspace(owner.id);
    if (!decisionsCardDue(workspace.prefs.decisionsCardShownOn, todayKey)) return null;
    const waiting = (await listDecisions(owner.id)).filter((card) => card.state !== "CONFIRMED").length;
    if (waiting === 0) return null;
    if (workspace.prefs.decisionsCardShownOn !== todayKey) await noteShown(owner.id, todayKey);
    return waiting;
  } catch (error) {
    await reportBackgroundError(error, "decisions-today-card");
    return null;
  }
}
