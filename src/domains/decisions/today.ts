import { prisma } from "@/lib/prisma";
import { reportBackgroundError } from "@/lib/report-error";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { addBusinessDays, businessDateFromKey, businessDateKey, businessDaysBetween } from "@/lib/business-date";
import { EMPTY_PREFERENCES, getWorkspace } from "@/domains/workspace";
import { DECISION_SUBJECTS } from "./registry";
import { decisionState } from "./rules";

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

/**
 * Remember today as the day the card was shown. Not a settings change: the workspace version is not bumped. Same
 * pattern as the workspace saves (src/domains/workspace/index.ts): one transaction, the owner re-checked (a
 * deactivated owner writes nothing), the row created if missing and locked before it is changed.
 */
export async function noteDecisionsCardShown(userId: string, todayKey: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) throw new Error("Invalid date.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const empty = JSON.stringify(EMPTY_PREFERENCES);
    await tx.$executeRaw`INSERT INTO "OwnerWorkspacePreference" ("userId","version","preferences","updatedAt") VALUES (${userId}, 1, ${empty}::jsonb, now()) ON CONFLICT ("userId") DO NOTHING`;
    await tx.$queryRaw`SELECT "userId" FROM "OwnerWorkspacePreference" WHERE "userId" = ${userId} FOR UPDATE`;
    await tx.$executeRaw`
      UPDATE "OwnerWorkspacePreference"
      SET "preferences" = jsonb_set(COALESCE("preferences", '{}'::jsonb), '{decisionsCardShownOn}', to_jsonb(${todayKey}::text), true),
          "updatedAt" = now()
      WHERE "userId" = ${userId}`;
  });
}

/**
 * How many questions are not confirmed: one light query (the newest record per question) instead of reading every
 * setting, because Today loads often. Same state rule as the Decisions & reviews screen.
 */
async function waitingCount(): Promise<number> {
  const newest = await prisma.decisionRecord.findMany({
    distinct: ["subjectId"],
    orderBy: [{ subjectId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { subjectId: true, kind: true, value: true },
  });
  const known = new Set(DECISION_SUBJECTS.map((subject) => subject.id));
  const confirmed = newest.filter((row) => known.has(row.subjectId) && decisionState(true, [row]) === "CONFIRMED").length;
  return DECISION_SUBJECTS.length - confirmed;
}

/** The number of decisions waiting when the card should show today, otherwise null. Never throws (Today must load). */
export async function decisionsTodayCount(owner: { id: string; role: string }, now = new Date()): Promise<number | null> {
  if (owner.role !== "OWNER") return null;
  try {
    const todayKey = businessDateKey(now);
    const workspace = await getWorkspace(owner.id);
    if (!decisionsCardDue(workspace.prefs.decisionsCardShownOn, todayKey)) return null;
    const waiting = await waitingCount();
    if (waiting === 0) return null;
    if (workspace.prefs.decisionsCardShownOn !== todayKey) await noteDecisionsCardShown(owner.id, todayKey);
    return waiting;
  } catch (error) {
    await reportBackgroundError(error, "decisions-today-card");
    return null;
  }
}
