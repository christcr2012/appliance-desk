import { prisma } from "@/lib/prisma";
import { reportBackgroundError } from "@/lib/report-error";
import { addBusinessDays, businessDateKey } from "@/lib/business-date";
import {
  applyStartingValue, loadDecisionContext, type DecisionVia,
} from "./index";
import { DECISION_SUBJECTS } from "./registry";
import { sameValue } from "./rules";

/**
 * DEC-2: put the researched starting values (docs/research/2026-10-25-open-decisions.md) into the live app.
 * Chris approved this on 2026-10-25. Rules that keep it safe:
 *  - once per question: a question that already has any record (an answer, a starting value, a "sent to your CPA") is left alone;
 *  - only over untouched defaults: a setting Chris or his CPA already changed is never overwritten;
 *  - from the next Colorado business day, through the decision center's scheduled-change path, so nothing already
 *    billed or signed changes (agreements keep their own terms, issued invoices keep their tax lines);
 *  - saved through each setting's own save as the one active owner, so the same locks, checks and history rows apply.
 */
export type StartingValuesResult = {
  applied: string[];
  confirmed: string[];
  skipped: { id: string; why: string }[];
};

const VIA: DecisionVia = "MIGRATION";

export async function applyStartingValues(now: Date = new Date()): Promise<StartingValuesResult> {
  const result: StartingValuesResult = { applied: [], confirmed: [], skipped: [] };
  const owners = await prisma.user.findMany({
    where: { role: "OWNER", archivedAt: null }, select: { id: true }, take: 2,
  });
  if (owners.length !== 1) {
    // Not an error: nothing is applied until there is exactly one active owner to act for.
    await reportBackgroundError(new Error(`Found ${owners.length} active owners; starting values wait for exactly one.`), "starting_values.no_single_owner");
    return result;
  }
  const actorId = owners[0]!.id;
  const effectiveFrom = businessDateKey(addBusinessDays(now, 1));

  const recorded = new Set(
    (await prisma.decisionRecord.findMany({ distinct: ["subjectId"], select: { subjectId: true } }))
      .map((row) => row.subjectId),
  );
  const ctx = await prisma.$transaction((tx) => loadDecisionContext(tx));

  for (const subject of DECISION_SUBJECTS) {
    const recommended = subject.recommended;
    if (!recommended) continue;
    if (recorded.has(subject.id)) continue; // idempotent: one starting value per question, ever
    const current = await subject.read(ctx);
    const untouched = current === "UNDECIDED" || sameValue(current, recommended.value) ||
      (subject.untouchedDefault !== undefined && sameValue(current, subject.untouchedDefault));
    if (current === null) {
      result.skipped.push({ id: subject.id, why: "Not set up yet" });
      continue;
    }
    if (!untouched) {
      result.skipped.push({ id: subject.id, why: "Already set by you" });
      continue;
    }
    try {
      // The checks above are only a first look; the save repeats them under its own lock so an answer given in the
      // meantime (or a second nightly run at the same moment) is never replaced.
      const outcome = await applyStartingValue(actorId, subject.id, {
        value: recommended.value, effectiveFrom, why: recommended.why, sources: recommended.sources,
        kind: recommended.kind ?? "STARTING_VALUE_APPLIED", onlyIfStillUntouched: true,
      }, VIA);
      if (outcome === "ALREADY_ANSWERED") result.skipped.push({ id: subject.id, why: "Answered a moment ago" });
      else if (outcome === "ALREADY_CHANGED") result.skipped.push({ id: subject.id, why: "Already set by you" });
      else (recommended.kind === "CONFIRMED" ? result.confirmed : result.applied).push(subject.id);
    } catch (error) {
      // One question that can't be applied yet (e.g. Greeley's tax area doesn't exist) never stops the rest.
      result.skipped.push({ id: subject.id, why: error instanceof Error ? error.message.slice(0, 200) : "Could not be applied" });
    }
  }
  return result;
}
