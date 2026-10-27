import type { Prisma } from "@prisma/client";
import { decisionSubject } from "./registry";
import { matchOption, sameValue } from "./rules";
import { ANSWER_SHEET_HEADING } from "./form-content";
import type { ParsedAnswer } from "./index";

/**
 * Reads a completed questionnaire back (DEC-1b, spec section 7). Pure: text in, answers out — nothing is saved here.
 * The import screen and the coding agent both preview these answers (previewAnswers) before anything is applied.
 *
 * Per code in brackets ([DQ-…]) it finds, inside that question's section: the ticked choice (☒, ☑, ✓, [x], or an X
 * before or after the box), "Other: …", "Effective from", the explanation and "Answered by / firm / date"; and on the
 * answer sheet, "Answer:" text matched to a choice's words (case ignored). Unknown codes are reported, never guessed.
 * Questions left blank are listed as unanswered and are not part of the answers.
 */
export type ParsedQuestionnaire = { answers: ParsedAnswer[]; unanswered: string[] };

const CODE = /\[\s*DQ-([A-Z0-9][A-Z0-9-]*)\s*\]/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december"];

const clean = (text: string) => text.replace(/_{2,}/g, " ").replace(/\s+/g, " ").trim();

/** "2026-11-01", "11/1/2026", "November 1, 2026" or "Nov 1 2026" → "2026-11-01"; anything else → null. */
export function readFormDate(raw: string): string | null {
  const text = clean(raw).replace(/\.$/, "");
  let year: number, month: number, day: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) [year, month, day] = [Number(m[3]), Number(m[1]), Number(m[2])];
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text))) {
    const name = m[1]!.toLowerCase();
    const index = MONTHS.findIndex((full) => full === name || (name.length >= 3 && full.startsWith(name)));
    if (index < 0) return null;
    [year, month, day] = [Number(m[3]), index + 1, Number(m[2])];
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const DATE_IN_TEXT = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/g;

/** "Jane Doe / Doe & Co CPAs / 11/2/2026" → name, firm, date (any order of separators: "/", ",", ";"). */
export function readAnsweredBy(raw: string): { name: string | null; firm: string | null; date: string | null } {
  let text = clean(raw);
  let date: string | null = null;
  const found = [...text.matchAll(DATE_IN_TEXT)].map((match) => match[0]).filter((candidate) => readFormDate(candidate));
  if (found.length) {
    const last = found[found.length - 1]!;
    date = readFormDate(last);
    const at = text.lastIndexOf(last);
    text = (text.slice(0, at) + text.slice(at + last.length)).trim();
  }
  const parts = text.split(/\s*[/;,]\s*|\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  return { name: parts[0] ?? null, firm: parts.slice(1).join(", ") || null, date };
}

type BoxLine = { ticked: boolean; label: string };

/** A choice line: a box (☐, [ ]) or a tick (☒, ☑, ✓, [x]) before the words; an X typed before or after the box ticks it. */
export function readBoxLine(line: string): BoxLine | null {
  const match = /^\s*((?:(?:☒|☑|✓|✔|✗|✘|☐|□|\[\s*[xX✓✔]?\s*\]|\(\s*[xX]?\s*\)|[xX](?=\s))\s*)+)(.*)$/.exec(line);
  if (!match) return null;
  const prefix = match[1]!;
  if (!/☒|☑|✓|✔|✗|✘|☐|□|\[|\(/.test(prefix)) return null; // an X alone is not a choice line
  const ticked = /☒|☑|✓|✔|✗|✘|\[\s*[xX✓✔]\s*\]|\(\s*[xX]\s*\)/.test(prefix) || /(^|\s|☐|□|\]|\))[xX](\s|$)/.test(prefix);
  return { ticked, label: clean(match[2] ?? "") };
}

type Section = {
  ticks: string[];
  other: string | null;
  effective: string | null;
  explanation: string[];
  answeredBy: string | null;
  headings: number;
};

type SheetEntry = {
  answer: string | null; effective: string | null; explanation: string | null; lines: number;
  /** A date line the reader could not tie safely to this answer. */
  problem: string | null;
};

const LOOSE_DATE = "An \"Effective from\" date isn't next to its answer. Put it on the answer's line and import again.";

const LABEL = {
  effective: /^\s*effective\s+from\s*:?\s*(.*)$/i,
  explanation: /^\s*your\s+explanation\b[^:]*:?\s*(.*)$/i,
  answeredBy: /^\s*answered\s+by\b(?:\s*\/\s*firm\s*\/\s*date)?\s*:?\s*(.*)$/i,
  other: /^other\s*:?\s*(.*)$/i,
};

function optionFor(code: string, words: string): { value: Prisma.JsonValue } | null {
  const subject = decisionSubject(code);
  if (!subject) return null;
  const option = matchOption(subject, words.replace(/[.;]+$/, "").trim());
  return option ? { value: option.value } : null;
}

export function parseQuestionnaire(text: string): ParsedQuestionnaire {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const sections = new Map<string, Section>();
  const sheet = new Map<string, SheetEntry>();
  const order: string[] = [];
  let sheetAnsweredBy: string | null = null;
  let inSheet = false;
  let current: Section | null = null;
  let mode: "none" | "explanation" = "none";
  let lastSheet: SheetEntry | null = null;
  /** The newest answer-sheet entry, kept after its explanation so a stray date line still lands on an answer. */
  let lastEntry: SheetEntry | null = null;
  /** "Effective from:" with nothing after it: the date may be on the next line (PDF and pasted line breaks). */
  let awaitingDate: { sheet: SheetEntry } | { section: Section } | null = null;
  let looseDate = false;
  const remember = (code: string) => { if (!order.includes(code)) order.push(code); };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (clean(line).toLowerCase() === ANSWER_SHEET_HEADING.toLowerCase()) {
      inSheet = true; current = null; mode = "none"; lastSheet = null; awaitingDate = null;
      continue;
    }
    const code = CODE.exec(line);
    if (code) {
      const id = code[1]!.toUpperCase();
      const rest = line.slice(code.index + code[0].length);
      const sheetLine = /^\s*answer\s*:/i.exec(rest);
      remember(id);
      if (sheetLine) {
        // "[DQ-X] Answer: … Effective from: …"
        const body = rest.slice(sheetLine[0].length);
        const split = /\s+effective\s+from\s*:?\s*/i.exec(body);
        const answer = clean(split ? body.slice(0, split.index) : body) || null;
        const effective = split ? clean(body.slice(split.index + split[0].length)) || null : null;
        const entry = sheet.get(id) ?? { answer: null, effective: null, explanation: null, lines: 0, problem: null };
        entry.lines += 1;
        // "Effective from:" at the end of the line with the date on the next one.
        awaitingDate = split && !effective ? { sheet: entry } : null;
        entry.answer = entry.answer ?? answer;
        entry.effective = entry.effective ?? effective;
        sheet.set(id, entry);
        lastSheet = entry; lastEntry = entry; current = null; mode = "none";
        continue;
      }
      if (inSheet) { lastSheet = null; awaitingDate = null; continue; }
      const section = sections.get(id) ?? { ticks: [], other: null, effective: null, explanation: [], answeredBy: null, headings: 0 };
      section.headings += 1;
      sections.set(id, section);
      current = section; mode = "none"; lastSheet = null; awaitingDate = null;
      continue;
    }
    if (awaitingDate) {
      const target = awaitingDate;
      awaitingDate = null;
      const words = clean(line);
      if (words && !LABEL.answeredBy.test(line) && !/^\s*explanation\b/i.test(line) && !readBoxLine(line) &&
          (readFormDate(words) || /^\d|^[A-Za-z]{3,9}\.?\s+\d/.test(words))) {
        if ("sheet" in target) target.sheet.effective = words;
        else target.section.effective = words;
        continue;
      }
    }
    // "Effective from: …" on its own line in the answer sheet belongs to the answer above it (PDF line breaks).
    if (!current) {
      const dated = LABEL.effective.exec(line);
      if (dated) {
        const value = clean(dated[1] ?? "") || null;
        const entry = lastSheet ?? lastEntry;
        if (!entry) { if (value) looseDate = true; continue; }
        if (!value) { if (lastSheet) awaitingDate = { sheet: entry }; else entry.problem = LOOSE_DATE; continue; }
        if (!lastSheet) entry.problem = LOOSE_DATE; // after its explanation: too far from the answer to be sure
        else if (entry.effective && entry.effective !== value) entry.problem = "The answer sheet gives two dates for this answer.";
        else entry.effective = value;
        continue;
      }
    }
    if (lastSheet) {
      const explained = /^\s*explanation\s*:?\s*(.*)$/i.exec(line);
      if (explained) { lastSheet.explanation = clean(explained[1] ?? "") || null; lastSheet = null; continue; }
    }
    const answeredBy = LABEL.answeredBy.exec(line);
    if (answeredBy) {
      const value = clean(answeredBy[1] ?? "") || null;
      if (current) current.answeredBy = value;
      else if (inSheet || !sections.size) sheetAnsweredBy = sheetAnsweredBy ?? value;
      mode = "none";
      continue;
    }
    if (!current) continue;
    const box = readBoxLine(line);
    if (box) {
      mode = "none";
      if (!box.ticked) continue;
      const other = LABEL.other.exec(box.label);
      if (other) current.other = clean(other[1] ?? "") || "";
      else current.ticks.push(box.label);
      continue;
    }
    const effective = LABEL.effective.exec(line);
    if (effective) {
      current.effective = clean(effective[1] ?? "") || null;
      awaitingDate = current.effective ? null : { section: current };
      mode = "none";
      continue;
    }
    const explanation = LABEL.explanation.exec(line);
    if (explanation) {
      mode = "explanation";
      const first = clean(explanation[1] ?? "");
      if (first) current.explanation.push(first);
      continue;
    }
    if (mode === "explanation") {
      const words = clean(line);
      if (words) current.explanation.push(words);
    }
  }

  const answers: ParsedAnswer[] = [];
  const unanswered: string[] = [];
  for (const code of order) {
    const section = sections.get(code);
    const entry = sheet.get(code);
    const problems: string[] = [];
    // Two sections or two answer-sheet lines for one code: never pick one of them.
    if ((section && section.headings > 1) || (entry && entry.lines > 1)) problems.push("This question appears more than once in the form.");
    if (entry?.problem) problems.push(entry.problem);
    // A date before any answer can't be tied to one: refuse every answer-sheet answer rather than guess.
    if (looseDate && entry) problems.push(LOOSE_DATE);
    const ticks = section ? [...section.ticks, ...(section.other !== null ? ["Other"] : [])] : [];
    if (ticks.length > 1) problems.push("Two answers were ticked.");

    let option: Prisma.JsonValue | null = null;
    let otherText: string | null = null;
    let answered = false;
    if (section && section.ticks.length === 1 && section.other === null) {
      option = optionFor(code, section.ticks[0]!)?.value ?? section.ticks[0]!;
      answered = true;
    } else if (section && section.other !== null && section.ticks.length === 0) {
      otherText = section.other || null;
      answered = true;
    }
    if (entry?.answer) {
      const other = LABEL.other.exec(entry.answer);
      const matched = other ? null : optionFor(code, entry.answer);
      const sheetOption = matched ? matched.value : null;
      const sheetOther = matched ? null : clean(other ? other[1] ?? "" : entry.answer) || null;
      if (!answered) {
        option = sheetOption;
        otherText = sheetOther;
        answered = true;
      } else {
        const bodyIsOther = otherText !== null || section?.other !== null;
        const differs = matched
          ? bodyIsOther || !sameValue(option, sheetOption)
          : !bodyIsOther || (otherText ?? "").toLowerCase() !== (sheetOther ?? "").toLowerCase();
        if (differs) problems.push("The question and the answer sheet give different answers.");
      }
    }
    if (!answered && ticks.length <= 1) {
      // Nothing ticked or written for this code: a question they skipped, not an answer.
      if (!section?.effective && !entry?.effective && !(section?.explanation.length) && !entry?.explanation) {
        unanswered.push(code);
        continue;
      }
      problems.push("No answer was ticked or written.");
    }

    const effectiveRaw = section?.effective ?? null;
    const sheetEffectiveRaw = entry?.effective ?? null;
    let effectiveFrom: string | null = null;
    for (const raw of [effectiveRaw, sheetEffectiveRaw]) {
      if (!raw || /^(today|now|immediately|right away)$/i.test(raw)) continue;
      const key = readFormDate(raw);
      if (!key) { problems.push(`The effective date "${raw.slice(0, 40)}" couldn't be read. Use a date like 2026-11-01.`); continue; }
      if (effectiveFrom && effectiveFrom !== key) problems.push("The question and the answer sheet give different dates.");
      effectiveFrom = effectiveFrom ?? key;
    }

    const by = readAnsweredBy(section?.answeredBy ?? sheetAnsweredBy ?? "");
    const explanation = [...(section?.explanation ?? []), ...(entry?.explanation ? [entry.explanation] : [])]
      .join("\n").slice(0, 4000) || null;
    answers.push({
      code,
      option: otherText !== null ? null : option,
      otherText,
      effectiveFrom,
      explanation,
      answeredBy: by.name,
      firm: by.firm,
      answeredOn: by.date,
      problem: problems.length ? [...new Set(problems)].join(" ") : null,
    });
  }
  return { answers, unanswered };
}

export function parseQuestionnaireAnswers(text: string): ParsedAnswer[] {
  return parseQuestionnaire(text).answers;
}
