import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getSetupRecordFacts } from "@/domains/paperwork/record-facts";
import {
  WALKTHROUGHS,
  getStep,
  getWalkthrough,
  suggestNextWalkthrough,
  type SetupCheck,
  type WalkthroughStanding,
} from "./walkthroughs";

/**
 * SETUP-1: the data side of the setup guide. Owner only — every write
 * re-checks the actor inside its transaction, and the screens require the
 * OWNER role before they call here.
 *
 * Progress is the audit log folded on read (no new table): marking a step
 * done writes `setup.step_done`, reopening writes `setup.step_reopened`,
 * and the latest row for a step wins. Dismissing a walkthrough ("Not for
 * me") writes `setup.dismissed`; `setup.restored` undoes it. A step whose
 * check passes is done regardless of the manual marks — the check is the
 * truth, the mark is the owner's word for steps the app cannot verify.
 *
 * Checks never reveal secret values: ENV_PRESENT tests presence only, and
 * no check result carries a value into a DTO.
 */

export type SetupStepStatus = {
  key: string;
  /** The automatic check passed (only set when the step has a check). */
  checked: boolean;
  /** The owner pressed "I did this" and has not reopened it since. */
  markedDone: boolean;
  done: boolean;
  /** The business record this step fills, when it exists already. */
  recordId: string | null;
  hasNumber: boolean;
  fileCount: number;
};

export type WalkthroughStatus = {
  key: string;
  totalSteps: number;
  doneSteps: number;
  complete: boolean;
  dismissed: boolean;
  steps: SetupStepStatus[];
};

export type SetupGuideState = {
  walkthroughs: WalkthroughStatus[];
  /** Finished (complete) walkthroughs out of all of them. */
  finishedCount: number;
  totalWalkthroughs: number;
  /** The suggested next walkthrough key, or null when nothing is left. */
  suggestedKey: string | null;
};

type SetupFacts = {
  markedDone: Set<string>; // `${walkthroughKey}/${stepKey}`
  dismissed: Set<string>; // walkthroughKey
  records: Map<string, { id: string; hasNumber: boolean; fileCount: number; hasBeenDone: boolean }>;
  filingKinds: Set<string>;
};

async function loadFacts(): Promise<SetupFacts> {
  const templateKeys = new Set<string>();
  for (const w of WALKTHROUGHS) {
    for (const s of w.steps) {
      if (s.record?.templateKey) templateKeys.add(s.record.templateKey);
      if (
        s.check &&
        (s.check.type === "RECORD_EXISTS" || s.check.type === "RECORD_HAS_NUMBER" || s.check.type === "RECORD_HAS_FILE")
      ) {
        templateKeys.add(s.check.templateKey);
      }
    }
  }
  const [audits, recordFacts, filingAccounts] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: "SetupGuide" },
      orderBy: { createdAt: "asc" },
      take: 2000,
      select: { action: true, entityId: true, newValue: true },
    }),
    // VAULT-2: presence facts come from the paperwork domain so the secret
    // column name stays inside that domain (see record-facts.ts).
    getSetupRecordFacts([...templateKeys]),
    prisma.taxFilingAccount.findMany({ where: { active: true }, select: { kind: true } }),
  ]);
  const markedDone = new Set<string>();
  const dismissed = new Set<string>();
  for (const row of audits) {
    if (row.entityId == null) continue;
    const stepKey = (row.newValue as { step?: unknown } | null)?.step;
    if (row.action === "setup.step_done" && typeof stepKey === "string") {
      markedDone.add(`${row.entityId}/${stepKey}`);
    } else if (row.action === "setup.step_reopened" && typeof stepKey === "string") {
      markedDone.delete(`${row.entityId}/${stepKey}`);
    } else if (row.action === "setup.dismissed") {
      dismissed.add(row.entityId);
    } else if (row.action === "setup.restored") {
      dismissed.delete(row.entityId);
    }
  }
  return {
    markedDone,
    dismissed,
    records: recordFacts,
    filingKinds: new Set(filingAccounts.map((a) => a.kind)),
  };
}

/** Evaluate one check against the facts. Presence/truth only — never a value. */
export function evaluateCheck(check: SetupCheck, facts: SetupFacts, env: NodeJS.ProcessEnv): boolean {
  switch (check.type) {
    case "ENV_PRESENT":
      return typeof env[check.env] === "string" && env[check.env]!.length > 0;
    case "ENV_ALL_PRESENT":
      return check.envs.every((name) => typeof env[name] === "string" && env[name]!.length > 0);
    case "RECORD_EXISTS":
      // Existence is not evidence: the starter checklist creates every record
      // empty. The step checks only once the record itself has been marked
      // done at least once (lastDoneOn) — the owner's own completion mark on
      // the record, not the row merely being there.
      return facts.records.get(check.templateKey)?.hasBeenDone === true;
    case "RECORD_HAS_NUMBER":
      return facts.records.get(check.templateKey)?.hasNumber === true;
    case "RECORD_HAS_FILE":
      return (facts.records.get(check.templateKey)?.fileCount ?? 0) > 0;
    case "FILING_ACCOUNT_SET":
      return facts.filingKinds.has(check.kind);
  }
}

export async function getSetupGuideState(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<SetupGuideState> {
  const facts = await loadFacts();
  const walkthroughs: WalkthroughStatus[] = WALKTHROUGHS.map((w) => {
    const steps: SetupStepStatus[] = w.steps.map((s) => {
      const checked = s.check ? evaluateCheck(s.check, facts, env) : false;
      const markedDone = facts.markedDone.has(`${w.key}/${s.key}`);
      const record = s.record ? facts.records.get(s.record.templateKey) : undefined;
      return {
        key: s.key,
        checked,
        markedDone,
        done: checked || markedDone,
        recordId: record?.id ?? null,
        hasNumber: record?.hasNumber ?? false,
        fileCount: record?.fileCount ?? 0,
      };
    });
    const doneSteps = steps.filter((s) => s.done).length;
    return {
      key: w.key,
      totalSteps: steps.length,
      doneSteps,
      complete: doneSteps === steps.length,
      dismissed: facts.dismissed.has(w.key),
      steps,
    };
  });
  const standings: WalkthroughStanding[] = walkthroughs.map((w) => ({
    key: w.key,
    complete: w.complete,
    dismissed: w.dismissed,
  }));
  const suggested = suggestNextWalkthrough(standings, now);
  return {
    walkthroughs,
    finishedCount: walkthroughs.filter((w) => w.complete).length,
    totalWalkthroughs: walkthroughs.length,
    suggestedKey: suggested?.key ?? null,
  };
}

async function auditSetup(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  walkthroughKey: string,
  stepKey?: string,
) {
  await tx.auditLog.create({
    data: {
      userId,
      action,
      entityType: "SetupGuide",
      entityId: walkthroughKey,
      ...(stepKey ? { newValue: { step: stepKey } } : {}),
    },
  });
}

async function writeProgress(
  userId: string,
  action: "setup.step_done" | "setup.step_reopened" | "setup.dismissed" | "setup.restored",
  walkthroughKey: string,
  stepKey?: string,
): Promise<void> {
  if (!getWalkthrough(walkthroughKey)) throw new Error("That walkthrough doesn't exist.");
  if (stepKey && !getStep(walkthroughKey, stepKey)) throw new Error("That step doesn't exist.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await auditSetup(tx, userId, action, walkthroughKey, stepKey);
  });
}

export async function markStepDone(userId: string, walkthroughKey: string, stepKey: string): Promise<void> {
  await writeProgress(userId, "setup.step_done", walkthroughKey, stepKey);
}

export async function reopenStep(userId: string, walkthroughKey: string, stepKey: string): Promise<void> {
  await writeProgress(userId, "setup.step_reopened", walkthroughKey, stepKey);
}

export async function dismissWalkthrough(userId: string, walkthroughKey: string): Promise<void> {
  await writeProgress(userId, "setup.dismissed", walkthroughKey);
}

export async function restoreWalkthrough(userId: string, walkthroughKey: string): Promise<void> {
  await writeProgress(userId, "setup.restored", walkthroughKey);
}
