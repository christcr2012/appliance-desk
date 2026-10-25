import { describe, expect, it } from "vitest";
import { parseQuestionnaire, parseQuestionnaireAnswers, readAnsweredBy, readBoxLine, readFormDate } from "@/domains/decisions/parse";
import { decisionSubject } from "@/domains/decisions/registry";

// DEC-1b: reading a completed questionnaire back (spec section 7). Pure; nothing is saved by the parser.

describe("parseQuestionnaireAnswers", () => {
  it("reads a handwritten-style answer sheet (typed or scanned, then pasted)", () => {
    const text = [
      "Answer sheet",
      "Answered by / firm / date: Maria Ortiz / Ortiz Tax LLC / Nov 2, 2026",
      "[DQ-IN-35-BASIS] Answer: report tax when it is billed (accrual)   Effective from: 2099-01-01",
      "Explanation: Accrual matches how the state return is filed.",
      "[dq-in-37-rdf]  Answer:  THE BUSINESS PAYS ANY DELIVERY FEE ITSELF.  Effective from: ________",
      "Explanation: ________________",
      "[DQ-IN-71] Answer: 12 years, because of the loan",
      "[DQ-IN-39-BADDEBT] Answer: ________  Effective from: ________",
    ].join("\n");
    const { answers, unanswered } = parseQuestionnaire(text);
    expect(unanswered).toEqual(["IN-39-BADDEBT"]);
    expect(answers).toEqual([
      { code: "IN-35-BASIS", option: decisionSubject("IN-35-BASIS")!.options[0]!.value, otherText: null,
        effectiveFrom: "2099-01-01", explanation: "Accrual matches how the state return is filed.",
        answeredBy: "Maria Ortiz", firm: "Ortiz Tax LLC", answeredOn: "2026-11-02", problem: null },
      { code: "IN-37-RDF", option: decisionSubject("IN-37-RDF")!.options[0]!.value, otherText: null,
        effectiveFrom: null, explanation: null, answeredBy: "Maria Ortiz", firm: "Ortiz Tax LLC",
        answeredOn: "2026-11-02", problem: null },
      // Not one of the choices: kept as "Other" (the app needs a change to follow it), never guessed.
      { code: "IN-71", option: null, otherText: "12 years, because of the loan", effectiveFrom: null, explanation: null,
        answeredBy: "Maria Ortiz", firm: "Ortiz Tax LLC", answeredOn: "2026-11-02", problem: null },
    ]);
  });

  it("two ticked boxes are refused with 'Two answers were ticked'", () => {
    const answers = parseQuestionnaireAnswers([
      "[DQ-IN-34-DELIVERY-STATE] Delivery charges",
      "Answer (tick one):",
      "☒ Charge sales tax on it",
      "[x] Don't charge sales tax on it",
      "☐ Other: ________________",
      "Answered by / firm / date: Jane Doe",
    ].join("\n"));
    expect(answers).toHaveLength(1);
    expect(answers[0]!.problem).toBe("Two answers were ticked.");
    expect(answers[0]!.option).toBeNull();
  });

  it("an X typed before or after the box ticks it; ticks in other sections stay with their own code", () => {
    const answers = parseQuestionnaireAnswers([
      "[DQ-IN-34-DELIVERY-STATE] Delivery",
      "☐ Charge sales tax on it",
      "X ☐ Don't charge sales tax on it",
      "[DQ-IN-34-INSTALLATION-STATE] Installation",
      "☐ X Charge sales tax on it",
      "☐ Don't charge sales tax on it",
      "Your explanation:",
      "Labor billed separately is not taxed",
      "________________________________",
      "and this is the second line",
      "Answered by / firm / date: Jane Doe",
    ].join("\n"));
    expect(answers.map((answer) => [answer.code, answer.option, answer.explanation])).toEqual([
      ["IN-34-DELIVERY-STATE", "EXEMPT", null],
      ["IN-34-INSTALLATION-STATE", "TAXABLE", "Labor billed separately is not taxed\nand this is the second line"],
    ]);
  });

  it("reports unknown codes instead of guessing, and flags a body/sheet disagreement", () => {
    const answers = parseQuestionnaireAnswers([
      "[DQ-NOT-A-QUESTION] Something",
      "☒ Yes",
      "Answered by: A",
      "[DQ-IN-35-BASIS] Basis",
      "☒ Report tax when it is billed (accrual)",
      "Answered by: A",
      "Answer sheet",
      "[DQ-IN-35-BASIS] Answer: Report tax when it is paid (cash)",
    ].join("\n"));
    expect(answers[0]).toMatchObject({ code: "NOT-A-QUESTION", option: "Yes" });
    expect(answers[1]!.problem).toBe("The question and the answer sheet give different answers.");
  });

  it("an unreadable effective date is a problem, not a guess", () => {
    const [answer] = parseQuestionnaireAnswers("[DQ-IN-71] x\n☒ 7 years after the appliance leaves the fleet\nEffective from: next spring\nAnswered by: A");
    expect(answer!.problem).toMatch(/couldn't be read/);
    expect(answer!.effectiveFrom).toBeNull();
  });

  it("no codes → nothing", () => {
    expect(parseQuestionnaire("hello\nworld")).toEqual({ answers: [], unanswered: [] });
  });
});

describe("pieces", () => {
  it("reads the three date formats and refuses impossible dates", () => {
    expect(readFormDate("2026-11-01")).toBe("2026-11-01");
    expect(readFormDate("11/1/2026")).toBe("2026-11-01");
    expect(readFormDate("November 1, 2026")).toBe("2026-11-01");
    expect(readFormDate("Nov. 1st 2026")).toBe("2026-11-01");
    expect(readFormDate("2026-02-30")).toBeNull();
    expect(readFormDate("13/1/2026")).toBeNull();
    expect(readFormDate("soon")).toBeNull();
  });

  it("reads who answered, their firm and the date", () => {
    expect(readAnsweredBy("Jane Doe / Doe & Co CPAs / 11/2/2026")).toEqual({ name: "Jane Doe", firm: "Doe & Co CPAs", date: "2026-11-02" });
    expect(readAnsweredBy("Jane Doe")).toEqual({ name: "Jane Doe", firm: null, date: null });
    expect(readAnsweredBy("")).toEqual({ name: null, firm: null, date: null });
  });

  it("tells ticked boxes from empty ones", () => {
    expect(readBoxLine("☐ Yes")).toEqual({ ticked: false, label: "Yes" });
    expect(readBoxLine("☒ Yes")).toEqual({ ticked: true, label: "Yes" });
    expect(readBoxLine("☑Yes")).toEqual({ ticked: true, label: "Yes" });
    expect(readBoxLine("[x] Yes")).toEqual({ ticked: true, label: "Yes" });
    expect(readBoxLine("[ ] Yes")).toEqual({ ticked: false, label: "Yes" });
    expect(readBoxLine("X [ ] Yes")).toEqual({ ticked: true, label: "Yes" });
    expect(readBoxLine("X marks the spot")).toBeNull();
    expect(readBoxLine("Plain line")).toBeNull();
  });
});
