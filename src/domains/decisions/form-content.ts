import type { Audience } from "./registry";

/**
 * The questionnaire a professional fills in (DEC-1b, docs/build-specs/engines/DECISIONS-CENTER.md section 7). Pure:
 * the same list of blocks is written as Word (.docx) and as PDF, so both formats always say the same thing, and the
 * parser in parse.ts reads back exactly these lines. Codes in brackets appear once in the body and once on the answer
 * sheet — nowhere else (the cover page never lists them).
 */
export type FormBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "small"; text: string }
  | { kind: "box"; text: string }
  | { kind: "blank" }
  | { kind: "pagebreak" };

export type FormQuestion = {
  id: string;
  title: string;
  question: string;
  facts: string;
  doingNow: string;
  why: string | null;
  sources: { title: string; url: string; checkedOn: string }[];
  options: string[];
  allowOther: boolean;
};

export type FormBusiness = { name: string; place: string; whatItDoes: string; startedOn: string };

export const ANSWER_SHEET_HEADING = "Answer sheet";
export const ANSWERED_BY_LABEL = "Answered by / firm / date:";
export const EFFECTIVE_LABEL = "Effective from:";
export const EXPLANATION_LABEL = "Your explanation:";
export const ANSWER_PROMPT = "Answer (tick one):";
export const FILL_LINE = "________________";
export const BOX_EMPTY = "☐";
export const NO_SOURCE_WHY =
  "No public source settles this yet, so the app does this — the most careful choice — until you answer.";
export const FORM_INSTRUCTIONS =
  "Tick one answer for each question, add any explanation, and fill in 'Answered by'. Please keep the codes in brackets.";

export const PROFESSIONAL_AUDIENCES = ["CPA", "ATTORNEY", "TRANSLATOR"] as const;
export type ProfessionalAudience = (typeof PROFESSIONAL_AUDIENCES)[number];

export function isProfessionalAudience(value: unknown): value is ProfessionalAudience {
  return typeof value === "string" && (PROFESSIONAL_AUDIENCES as readonly string[]).includes(value);
}

/** "CPA", "attorney", "translator" — as in "For your CPA" and "Questions for my attorney". */
export function audienceWord(audience: Audience): string {
  return audience === "CPA" ? "CPA" : audience === "ATTORNEY" ? "attorney" : audience === "TRANSLATOR" ? "translator" : "business";
}

export function questionCode(id: string): string {
  return `[DQ-${id}]`;
}

/** decisions-cpa-2026-10-25.docx */
export function formFilename(audience: Audience, dateKey: string, ext: "docx" | "pdf"): string {
  return `decisions-${audience.toLowerCase()}-${dateKey}.${ext}`;
}

export function formTitle(audience: Audience, dateText: string): string {
  return `Questions for my ${audienceWord(audience)} — Robinson Appliance Rentals — ${dateText}`;
}

export function buildQuestionnaire(input: {
  audience: Audience;
  dateText: string;
  business: FormBusiness;
  questions: FormQuestion[];
}): FormBlock[] {
  const blocks: FormBlock[] = [
    { kind: "title", text: formTitle(input.audience, input.dateText) },
    { kind: "heading", text: "About the business" },
    { kind: "text", text: `Business: ${input.business.name}` },
    { kind: "text", text: `Where: ${input.business.place}` },
    { kind: "text", text: `What it does: ${input.business.whatItDoes}` },
    { kind: "text", text: `Books start date: ${input.business.startedOn}` },
    { kind: "heading", text: "How to fill this in" },
    { kind: "text", text: FORM_INSTRUCTIONS },
    { kind: "small", text: "Each question shows what the app does now. If that is right, tick it — the app keeps doing it. " +
      "If an answer should start on a later date, write that date next to 'Effective from'. Nothing here changes " +
      "bills or tax already charged." },
    { kind: "small", text: input.questions.length === 1 ? "There is 1 question." : `There are ${input.questions.length} questions.` },
  ];
  for (const q of input.questions) {
    blocks.push(
      { kind: "pagebreak" },
      { kind: "heading", text: `${questionCode(q.id)} ${q.title}` },
      { kind: "text", text: q.question },
      { kind: "small", text: `What you need to know: ${q.facts}` },
      { kind: "text", text: `What the app does now: ${q.doingNow} — ${q.why ?? NO_SOURCE_WHY}` },
    );
    if (q.sources.length === 0) blocks.push({ kind: "small", text: "Sources: none found yet." });
    else {
      blocks.push({ kind: "small", text: "Sources:" });
      for (const source of q.sources) {
        blocks.push({ kind: "small", text: `• ${source.title} (checked ${source.checkedOn}) ${source.url}` });
      }
    }
    blocks.push({ kind: "text", text: ANSWER_PROMPT });
    for (const option of q.options) blocks.push({ kind: "box", text: `${BOX_EMPTY} ${option}` });
    if (q.allowOther) blocks.push({ kind: "box", text: `${BOX_EMPTY} Other: ${FILL_LINE}` });
    blocks.push(
      { kind: "text", text: `${EFFECTIVE_LABEL} ${FILL_LINE}` },
      { kind: "text", text: EXPLANATION_LABEL },
      { kind: "blank" }, { kind: "blank" }, { kind: "blank" }, { kind: "blank" }, { kind: "blank" },
      { kind: "text", text: `${ANSWERED_BY_LABEL} ${FILL_LINE}` },
    );
  }
  blocks.push(
    { kind: "pagebreak" },
    { kind: "heading", text: ANSWER_SHEET_HEADING },
    { kind: "small", text: "If it is easier, write each answer here instead of ticking boxes. Keep the codes in brackets." },
    { kind: "text", text: `${ANSWERED_BY_LABEL} ${FILL_LINE}` },
  );
  for (const q of input.questions) {
    blocks.push(
      { kind: "text", text: `${questionCode(q.id)} Answer: ${FILL_LINE}  ${EFFECTIVE_LABEL} ${FILL_LINE}` },
      { kind: "text", text: `Explanation: ${FILL_LINE}` },
    );
  }
  return blocks;
}
