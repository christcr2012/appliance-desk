import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DECISION_SUBJECTS, decisionSubject } from "@/domains/decisions/registry";
import { isRuleKey } from "@/domains/rules/registry";
import { allTaxCellSubjectIds, taxCellForSubject, taxCellSubjectId } from "@/domains/decisions/tax-cells";
import { BANNED } from "../scripts/check-owner-wording.mjs";

const schema = readFileSync("prisma/schema.prisma", "utf8");

/** model name → { field → type } from the schema text. */
function schemaFields() {
  const models = new Map<string, Map<string, string>>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = new Map<string, string>();
    for (const line of match[2]!.split("\n")) {
      const field = /^\s+(\w+)\s+(\w+)/.exec(line);
      if (field && !line.trim().startsWith("//") && !line.trim().startsWith("@@")) fields.set(field[1]!, field[2]!);
    }
    models.set(match[1]!, fields);
  }
  return models;
}

function enumsWithUndecided(): string[] {
  return [...schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)]
    .filter((match) => /^\s+UNDECIDED\s*$/m.test(match[2]!))
    .map((match) => match[1]!);
}

describe("Decisions & reviews registry", () => {
  it("has unique, stable codes made of capitals, digits and hyphens", () => {
    const ids = DECISION_SUBJECTS.map((subject) => subject.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z0-9-]+$/);
    for (const id of ids) expect(decisionSubject(id)?.id).toBe(id);
  });

  it("starts with every tax and wording subject the spec names", () => {
    const legacy = new Set(DECISION_SUBJECTS.flatMap((subject) => subject.legacyIds));
    for (const code of ["IN-33", "IN-34", "IN-35", "IN-37", "IN-39", "IN-44", "IN-46", "IN-56", "IN-65", "IN-71",
      "IN-79", "IN-07", "IN-21", "IN-31", "IN-38", "IN-52", "IN-76", "IN-78", "IN-83", "IN-84", "IN-06"]) {
      expect(legacy.has(code), code).toBe(true);
    }
    // One subject per charge category for the state defaults (rent follows the lease choice) and for Greeley.
    expect(allTaxCellSubjectIds()).toHaveLength(11 + 13);
    for (const id of allTaxCellSubjectIds()) expect(decisionSubject(id), id).not.toBeNull();
  });

  it("maps every taxability subject to exactly one cell and back", () => {
    for (const id of allTaxCellSubjectIds()) expect(taxCellSubjectId(taxCellForSubject(id)!)).toBe(id);
    expect(taxCellForSubject("IN-33-GREELEY")).toEqual({ scope: "GREELEY", category: "RENTAL" });
    expect(taxCellForSubject("IN-34-RENTAL-STATE")).toBeNull();
    expect(taxCellForSubject("IN-71")).toBeNull();
  });

  it("links only to screens that exist", () => {
    for (const subject of DECISION_SUBJECTS) {
      expect(subject.affects.length, subject.id).toBeGreaterThan(0);
      for (const { href } of subject.affects) {
        const path = href.split(/[?#]/)[0]!;
        expect(existsSync(`src/app${path}/page.tsx`), `${subject.id} → ${href}`).toBe(true);
      }
    }
  });

  it("offers only values the setting's own validator accepts, never 'not decided'", () => {
    for (const subject of DECISION_SUBJECTS) {
      expect(subject.options.length, subject.id).toBeGreaterThan(0);
      for (const option of subject.options) {
        expect(subject.validate(option.value), `${subject.id}: ${JSON.stringify(option.value)}`).toBeNull();
        expect(option.value).not.toBe("UNDECIDED");
      }
      expect(new Set(subject.options.map((option) => JSON.stringify(option.value))).size).toBe(subject.options.length);
    }
  });

  it("refuses values the setting does not accept", () => {
    expect(decisionSubject("IN-33-ELECTION")!.validate("SOMETHING_ELSE")).not.toBeNull();
    expect(decisionSubject("IN-34-DELIVERY-STATE")!.validate("MAYBE")).not.toBeNull();
    expect(decisionSubject("IN-71")!.validate(0)).not.toBeNull();
    expect(decisionSubject("IN-39-BADDEBT")!.validate("PERHAPS")).not.toBeNull();
    expect(decisionSubject("IN-84")!.validate("SOMETHING")).not.toBeNull();
  });

  it("covers every stored field that can be 'not decided yet'", () => {
    const models = schemaFields();
    const undecidedEnums = enumsWithUndecided();
    expect(undecidedEnums.sort()).toEqual(["RdfHandling", "ShortTermLeaseElection", "TaxReportingBasis", "Taxability"]);
    const required = new Set([
      "BusinessSettings.setupFeeTaxTreatment", "BusinessSettings.badDebtTaxRecovery",
      "BusinessSettings.retailDeliveryFeeDecision",
    ]);
    for (const [model, fields] of models) {
      for (const [field, type] of fields) if (undecidedEnums.includes(type)) required.add(`${model}.${field}`);
    }
    // Snapshot copies of a decision (history rows) are not settings; the live cell is TaxabilityRule.taxability.
    required.delete("TaxabilityRuleVersion.taxability");
    const covered = new Set(DECISION_SUBJECTS.flatMap((subject) => subject.covers));
    for (const field of required) expect(covered.has(field), field).toBe(true);
    for (const field of covered) {
      if (field.includes(":")) {
        // A dated rule, not a stored field: the model must exist and the
        // rule key must be registered (TFA-1).
        const [model, ruleKey] = field.split(":");
        expect(models.has(model!), `${field} model exists in the schema`).toBe(true);
        expect(isRuleKey(ruleKey!), `${field} rule is registered`).toBe(true);
        continue;
      }
      const [model, name] = field.split(".");
      expect(models.get(model!)?.has(name!), `${field} exists in the schema`).toBe(true);
    }
  });

  it("uses plain words in everything the owner and professionals read", () => {
    for (const subject of DECISION_SUBJECTS) {
      const texts = [subject.title, subject.question, subject.facts, ...subject.options.map((o) => o.label),
        ...subject.options.map((o) => subject.describe(o.value)), subject.describe("UNDECIDED"),
        ...subject.affects.map((a) => a.label)];
      for (const text of texts) {
        for (const rule of BANNED as { pattern: RegExp; say: string }[]) {
          expect(rule.pattern.test(text), `${subject.id}: "${text}" → say ${rule.say}`).toBe(false);
        }
      }
    }
  });

  it("every question has a researched starting value, or says why it has none (DEC-2)", () => {
    for (const subject of DECISION_SUBJECTS) {
      expect(subject.recommended, `${subject.id} has no starting value and no reason`).not.toBeNull();
    }
  });

  it("every starting value is one of the question's own choices and passes the setting's own check", () => {
    for (const subject of DECISION_SUBJECTS) {
      const value = subject.recommended!.value;
      expect(subject.options.some((option) => JSON.stringify(option.value) === JSON.stringify(value)),
        `${subject.id}: ${JSON.stringify(value)} is not one of its choices`).toBe(true);
      expect(subject.validate(value), subject.id).toBeNull();
    }
  });

  it("every starting value explains itself in plain words and cites sources with the date they were opened", () => {
    for (const subject of DECISION_SUBJECTS) {
      const { why, sources } = subject.recommended!;
      expect(why.length, `${subject.id} why`).toBeGreaterThan(30);
      expect(why, `${subject.id}: statute and letter numbers belong in sources`).not.toMatch(/C\.R\.S\.|GIL-|PLR-/);
      expect(sources.length, `${subject.id} sources`).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.url, subject.id).toMatch(/^(https:\/\/|docs\/)/);
        expect(source.checkedOn, subject.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (source.url.startsWith("docs/")) expect(existsSync(source.url.split("#")[0]!), `${subject.id}: ${source.url}`).toBe(true);
      }
    }
  });

  it("the careful tax choices match the research file", () => {
    const value = (id: string) => decisionSubject(id)!.recommended!.value;
    expect(value("IN-33-ELECTION")).toBe("PAY_ON_ACQUISITION");
    expect(value("IN-34-LATE-PAYMENT-FEE-STATE")).toBe("EXEMPT");
    expect(value("IN-34-DELIVERY-STATE")).toBe("TAXABLE");
    for (const id of allTaxCellSubjectIds().filter((code) => code.endsWith("-GREELEY") || code === "IN-33-GREELEY")) {
      expect(value(id), id).toBe("TAXABLE");
    }
    expect(value("IN-35-BASIS")).toBe("ACCRUAL");
    expect(value("IN-37-RDF")).toBe("PAY_MYSELF");
    expect(value("IN-39-BADDEBT")).toBe("NO");
    expect(value("IN-71")).toBe(7);
    expect(value("LATE-FEE-AMOUNT")).toBe(500);
    expect(value("GREELEY-RATE-2F")).toBe(4110);
  });

  it("questions Chris already answered are applied as confirmed; the rest are starting values", () => {
    for (const id of ["IN-84", "IN-06", "IN-76", "IN-52", "IN-78", "IN-83", "LATE-FEE-AMOUNT"]) {
      expect(decisionSubject(id)!.recommended!.kind, id).toBe("CONFIRMED");
    }
    for (const id of ["IN-33-ELECTION", "IN-44", "IN-79"]) {
      expect(decisionSubject(id)!.recommended!.kind ?? "STARTING_VALUE_APPLIED", id).toBe("STARTING_VALUE_APPLIED");
    }
  });

  it("only the retired-appliance tax figure is an estimate; everything else runs live", () => {
    for (const subject of DECISION_SUBJECTS) {
      expect(subject.liveUse, subject.id).toBe(subject.id === "IN-56" ? "ESTIMATE_ONLY" : "YES");
    }
  });

  it("reads each value from the setting in one shared context", async () => {
    const ctx = {
      settings: { shortTermLeaseElection: "PAY_ON_ACQUISITION", rdfHandling: "UNDECIDED",
        retailDeliveryFeeDecision: "NOT_LIABLE", badDebtTaxRecovery: "NO", setupFeeTaxPlanningTreatment: "TAXABLE",
        setupFeeTaxTreatment: "UNDECIDED", recordRetentionYears: 7, trustedDeviceDays: 30 },
      taxCells: [
        { jurisdictionId: null, category: "DELIVERY" as const, taxability: "TAXABLE", provisional: true },
        { jurisdictionId: "greeley", category: "RENTAL" as const, taxability: "EXEMPT", provisional: false },
      ],
      greeleyJurisdictionId: "greeley",
      filingBases: ["ACCRUAL", "ACCRUAL"],
    };
    expect(await decisionSubject("IN-33-ELECTION")!.read(ctx)).toBe("PAY_ON_ACQUISITION");
    expect(await decisionSubject("IN-34-DELIVERY-STATE")!.read(ctx)).toBe("TAXABLE");
    expect(await decisionSubject("IN-34-INSTALLATION-STATE")!.read(ctx)).toBe("UNDECIDED");
    expect(await decisionSubject("IN-33-GREELEY")!.read(ctx)).toBe("EXEMPT");
    expect(await decisionSubject("IN-35-BASIS")!.read(ctx)).toBe("ACCRUAL");
    expect(await decisionSubject("IN-35-BASIS")!.read({ ...ctx, filingBases: ["ACCRUAL", "CASH"] })).toBe("MIXED");
    expect(await decisionSubject("IN-35-BASIS")!.read({ ...ctx, filingBases: [] })).toBe("UNDECIDED");
    expect(await decisionSubject("IN-33-GREELEY")!.read({ ...ctx, greeleyJurisdictionId: null })).toBe("UNDECIDED");
    expect(await decisionSubject("IN-71")!.read(ctx)).toBe(7);
    expect(await decisionSubject("TRUSTED-DEVICE-DAYS")!.read(ctx)).toBe(30);
    expect(await decisionSubject("IN-84")!.read(ctx)).toBe("AS_BUILT");
  });
});
