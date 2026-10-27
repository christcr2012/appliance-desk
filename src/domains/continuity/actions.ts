import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { CHECKUP_KEYS, PAUSE_NOTE_MAX, checkupYear, cleanProfile, cleanTicked, type ProfileKey } from "./rules";

const lock = (tx: { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> }) =>
  tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;

/** Save the "If something happens to me" details. Owner only; one audit line; changes nothing else. */
export async function saveContinuityProfile(userId: string, input: Partial<Record<ProfileKey, string | null>>, now = new Date()): Promise<void> {
  const clean = cleanProfile(input);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
    await lock(tx);
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { ...clean, continuityReviewedAt: now } });
    await tx.auditLog.create({
      data: { userId, action: "continuity.profile_saved", entityType: "BusinessSettings", entityId: "singleton", newValue: { filled: Object.values(clean).filter(Boolean).length } },
    });
  });
}

export type PauseResult = { changed: boolean; paused: boolean };

/**
 * The owner-only "Pause all automatic charges" switch. On: the nightly jobs listed in rules.ts skip their runs.
 * It never refunds, cancels, or edits an invoice, and payments customers make themselves still work. Idempotent:
 * pressing it twice changes nothing and writes one audit line.
 */
export async function setChargesPaused(userId: string, paused: boolean, note: string | null, now = new Date()): Promise<PauseResult> {
  const cleanNote = (note ?? "").replace(/\s+/g, " ").trim();
  if (cleanNote.length > PAUSE_NOTE_MAX) throw new Error(`The note is too long (most ${PAUSE_NOTE_MAX} characters).`);
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
    await lock(tx);
    const before = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { chargesPausedAt: true, chargesPausedNote: true } });
    const wasPaused = before.chargesPausedAt !== null;
    if (wasPaused === paused) return { changed: false, paused };
    await tx.businessSettings.update({
      where: { id: "singleton" },
      data: paused
        ? { chargesPausedAt: now, chargesPausedByUserId: userId, chargesPausedNote: cleanNote || null }
        : { chargesPausedAt: null, chargesPausedByUserId: null, chargesPausedNote: null },
    });
    await tx.auditLog.create({
      data: {
        userId, action: paused ? "continuity.charges_paused" : "continuity.charges_resumed", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { paused: wasPaused, note: before.chargesPausedNote }, newValue: { paused, note: cleanNote || null },
      },
    });
    return { changed: true, paused };
  });
}

/** Finish this year's December check-up. Records which items were looked at; changes nothing else. Once per year. */
export async function completeYearlyCheckup(userId: string, ticked: readonly string[], note: string | null, now = new Date()): Promise<{ year: number }> {
  const keys = cleanTicked(ticked);
  const cleanNote = (note ?? "").trim().slice(0, 1000) || null;
  const year = checkupYear(now);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
    await lock(tx);
    const existing = await tx.yearlyCheckup.findUnique({ where: { year } });
    if (existing) throw new Error(`This year's check-up is already finished (${existing.completedAt.toISOString().slice(0, 10)}).`);
    await tx.yearlyCheckup.create({ data: { year, completedByUserId: userId, ticked: keys, note: cleanNote } });
    await tx.auditLog.create({
      data: { userId, action: "continuity.checkup_completed", entityType: "YearlyCheckup", entityId: String(year), newValue: { items: keys.length, of: CHECKUP_KEYS.length } },
    });
  });
  return { year };
}
