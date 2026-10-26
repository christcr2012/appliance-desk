import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { DECISION_SUBJECTS, decisionSubject } from "@/domains/decisions/registry";
import {
  ANSWER_SHEET_HEADING,
  buildQuestionnaire,
  formFilename,
  formTitle,
  type FormQuestion,
} from "@/domains/decisions/form-content";
import { pdfSafeText, questionnaireDocx, questionnairePdf } from "@/domains/decisions/form-files";
import { parseQuestionnaire } from "@/domains/decisions/parse";

/**
 * DEC-1b questionnaire forms (spec section 7): both formats carry every open code exactly once in the body and once
 * on the answer sheet, and a downloaded .docx filled in programmatically reads back to the same answers.
 */
const question = (id: string): FormQuestion => {
  const subject = decisionSubject(id)!;
  return {
    id, title: subject.title, question: subject.question, facts: subject.facts, doingNow: "Not decided yet",
    why: null, sources: [], options: subject.options.map((option) => option.label), allowOther: subject.allowOther,
  };
};

const CODES = ["IN-34-DELIVERY-STATE", "IN-35-BASIS", "IN-71", "IN-39-BADDEBT"];
const blocks = () => buildQuestionnaire({
  audience: "CPA",
  dateText: "Sunday, October 25, 2026",
  business: { name: "Robinson Appliance Rentals", place: "Greeley (Weld County), Colorado, USA", whatItDoes: "Rents appliances.", startedOn: "Not set in the app yet" },
  questions: CODES.map(question),
});

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

function codesOnceEach(text: string, sheetHeading = ANSWER_SHEET_HEADING) {
  const at = text.lastIndexOf(sheetHeading);
  expect(at).toBeGreaterThan(0);
  const [body, sheet] = [text.slice(0, at), text.slice(at)];
  for (const code of CODES) {
    expect(occurrences(body, `[DQ-${code}]`), `${code} in the body`).toBe(1);
    expect(occurrences(sheet, `[DQ-${code}]`), `${code} on the answer sheet`).toBe(1);
  }
}

/** Text drawn on a pdf-lib page: inflate each content stream and decode its hex strings. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  const stream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = stream.exec(raw); match; match = stream.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1");
    } catch {
      content = match[1]!;
    }
    for (const hex of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(hex[1]!, "hex").toString("latin1"));
  }
  return out.join("\n");
}

async function fill(docx: Buffer, edits: { after: string; find: string; replace: string }[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file("word/document.xml")!.async("string");
  for (const edit of edits) {
    const start = xml.indexOf(edit.after);
    expect(start, edit.after).toBeGreaterThanOrEqual(0);
    const at = xml.indexOf(edit.find, start);
    expect(at, edit.find).toBeGreaterThan(start);
    xml = xml.slice(0, at) + edit.replace + xml.slice(at + edit.find.length);
  }
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("questionnaire content", () => {
  it("has the title, the instructions and every code once in the body and once on the answer sheet", () => {
    const text = blocks().map((block) => ("text" in block ? block.text : "")).join("\n");
    expect(text).toContain("Questions for my CPA — Robinson Appliance Rentals — Sunday, October 25, 2026");
    expect(text).toContain("Tick one answer for each question, add any explanation, and fill in 'Answered by'. Please keep the codes in brackets.");
    codesOnceEach(text);
    expect(occurrences(text, "☐ Charge sales tax on it")).toBe(1);
    expect(occurrences(text, "☐ Other:")).toBe(CODES.length);
  });

  it("names the file decisions-{audience}-{date}", () => {
    expect(formFilename("CPA", "2026-10-25", "docx")).toBe("decisions-cpa-2026-10-25.docx");
    expect(formFilename("ATTORNEY", "2026-10-25", "pdf")).toBe("decisions-attorney-2026-10-25.pdf");
    expect(formTitle("TRANSLATOR", "today")).toBe("Questions for my translator — Robinson Appliance Rentals — today");
  });

  it("works for every question in the registry", () => {
    const all = buildQuestionnaire({ audience: "CPA", dateText: "d", business: { name: "n", place: "p", whatItDoes: "w", startedOn: "s" },
      questions: DECISION_SUBJECTS.map((subject) => question(subject.id)) });
    const text = all.map((block) => ("text" in block ? block.text : "")).join("\n");
    for (const subject of DECISION_SUBJECTS) expect(occurrences(text, `[DQ-${subject.id}]`)).toBe(2);
  });
});

describe("downloaded files", () => {
  it("Word (.docx): every code once in the body and once on the answer sheet", async () => {
    const docx = await questionnaireDocx(blocks(), "t");
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    const { value } = await mammoth.extractRawText({ buffer: docx });
    codesOnceEach(value);
  });

  it("PDF: every code once in the body and once on the answer sheet, drawn in Helvetica", async () => {
    const pdf = await questionnairePdf(blocks(), "Questions for my CPA — x");
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    const text = pdfText(pdf);
    codesOnceEach(text);
    expect(text).toContain("[ ] Charge sales tax on it");
  });

  it("PDF text only uses characters Helvetica can draw", () => {
    expect(pdfSafeText("☐ Yes → ok ≤ 5 😀")).toBe("[ ] Yes -> ok <= 5 ??");
    expect(pdfSafeText("Don’t — “quoted” • done")).toBe("Don’t — “quoted” • done");
  });
});

describe("round trip: download, fill in, import", () => {
  it("a .docx filled in programmatically reads back to the same answers", async () => {
    const docx = await questionnaireDocx(blocks(), "t");
    const filled = await fill(docx, [
      { after: "[DQ-IN-34-DELIVERY-STATE]", find: "☐ Charge sales tax on it", replace: "☒ Charge sales tax on it" },
      { after: "[DQ-IN-34-DELIVERY-STATE]", find: "Effective from: ________________", replace: "Effective from: 12/1/2099" },
      { after: "[DQ-IN-34-DELIVERY-STATE]", find: "________________________________________________", replace: "Delivery is part of the sale in Colorado." },
      { after: "[DQ-IN-34-DELIVERY-STATE]", find: "Answered by / firm / date: ________________", replace: "Answered by / firm / date: Jane Doe / Doe CPAs / 2026-10-20" },
      { after: "[DQ-IN-35-BASIS]", find: "☐ Other: ________________", replace: "☒ Other: Ask again after the first year" },
      { after: "[DQ-IN-35-BASIS]", find: "Answered by / firm / date: ________________", replace: "Answered by / firm / date: Jane Doe, Doe CPAs, October 20, 2026" },
      { after: ANSWER_SHEET_HEADING, find: "[DQ-IN-71] Answer: ________________", replace: "[DQ-IN-71] Answer: 7 years after the appliance leaves the fleet" },
      { after: ANSWER_SHEET_HEADING, find: "Answered by / firm / date: ________________", replace: "Answered by / firm / date: Jane Doe / Doe CPAs / 10/20/2026" },
    ]);
    const { value } = await mammoth.extractRawText({ buffer: filled });
    const parsed = parseQuestionnaire(value);
    expect(parsed.unanswered).toEqual(["IN-39-BADDEBT"]);
    expect(parsed.answers).toEqual([
      { code: "IN-34-DELIVERY-STATE", option: "TAXABLE", otherText: null, effectiveFrom: "2099-12-01",
        explanation: "Delivery is part of the sale in Colorado.", answeredBy: "Jane Doe", firm: "Doe CPAs",
        answeredOn: "2026-10-20", problem: null },
      { code: "IN-35-BASIS", option: null, otherText: "Ask again after the first year", effectiveFrom: null,
        explanation: null, answeredBy: "Jane Doe", firm: "Doe CPAs", answeredOn: "2026-10-20", problem: null },
      { code: "IN-71", option: decisionSubject("IN-71")!.options[1]!.value, otherText: null, effectiveFrom: null,
        explanation: null, answeredBy: "Jane Doe", firm: "Doe CPAs", answeredOn: "2026-10-20", problem: null },
    ]);
  });
});
