"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  changeDecision,
  confirmDecision,
  reopenDecision,
  sendToProfessional,
  type Audience,
} from "@/domains/decisions";
import { decisionSubject } from "@/domains/decisions/registry";
import { decisionErrorMessage } from "@/domains/decisions/messages";

// DEC-1b: Settings › Decisions & reviews actions. Owner only: requireRole is the coarse front door; the decisions
// domain re-checks the owner inside its transaction and locks the settings row before anything is written.

export type DecisionActionResult = { success: string } | { error: string };

async function run(work: () => Promise<string>): Promise<DecisionActionResult> {
  try {
    const message = await work();
    revalidatePath("/desk/settings/decisions");
    return { success: message };
  } catch (error) {
    return { error: decisionErrorMessage(error) };
  }
}

function field(form: FormData, name: string, max = 4000): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

function subjectFrom(form: FormData) {
  const subject = decisionSubject(field(form, "id", 120));
  if (!subject) throw new Error("That question isn't in Decisions & reviews.");
  return subject;
}

/** "Keep this": confirm the value the app uses now (refused if it changed since the page was opened). */
export async function keepDecisionAction(form: FormData): Promise<DecisionActionResult> {
  const session = await requireRole("OWNER");
  return run(async () => {
    const subject = subjectFrom(form);
    let expected: unknown;
    try {
      expected = JSON.parse(field(form, "expected", 2000));
    } catch {
      throw new Error("Refresh the page and try again.");
    }
    await confirmDecision(session.user.id, subject.id, expected as never);
    return `Kept: ${subject.title}`;
  });
}

/** "Change…": one of the question's choices, from today or a later date, with an optional note. */
export async function changeDecisionAction(form: FormData): Promise<DecisionActionResult> {
  const session = await requireRole("OWNER");
  return run(async () => {
    const subject = subjectFrom(form);
    const index = Number(field(form, "option", 4));
    const option = Number.isInteger(index) ? subject.options[index] : undefined;
    if (!option) throw new Error("Choose one of the answers.");
    const effectiveFrom = field(form, "effectiveFrom", 10).trim() || null;
    await changeDecision(session.user.id, subject.id, option.value, effectiveFrom, field(form, "note") || null);
    return effectiveFrom ? `Saved. "${option.label}" starts on the date you chose.` : `Changed: ${subject.title}`;
  });
}

const PROFESSIONAL_WORDS: Record<string, string> = { CPA: "CPA", ATTORNEY: "attorney", TRANSLATOR: "translator" };

/** "Ask my CPA / attorney / translator": the question moves to that tab; the current value keeps running. */
export async function askProfessionalAction(form: FormData): Promise<DecisionActionResult> {
  const session = await requireRole("OWNER");
  return run(async () => {
    const subject = subjectFrom(form);
    const audience = field(form, "audience", 20);
    if (!PROFESSIONAL_WORDS[audience]) throw new Error("Choose your CPA, attorney or translator.");
    await sendToProfessional(session.user.id, subject.id, audience as Audience);
    return `Moved to "For your ${PROFESSIONAL_WORDS[audience]}". The app keeps doing what it does now.`;
  });
}

/** "Reopen": back to "Starting value"; the value the app uses stays as it is. */
export async function reopenDecisionAction(form: FormData): Promise<DecisionActionResult> {
  const session = await requireRole("OWNER");
  return run(async () => {
    const subject = subjectFrom(form);
    await reopenDecision(session.user.id, subject.id);
    return `Reopened: ${subject.title}`;
  });
}
