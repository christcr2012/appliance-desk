import { taxCentsForLine } from "@/domains/billing/tax";
import {
  categoryForLineKind,
  type InvoiceLineItemKind,
  type LineTaxCategory,
  type TaxChargeCategory,
} from "@/domains/tax/categories";

export type Taxability = "TAXABLE" | "EXEMPT" | "UNDECIDED";
export type ShortTermLeaseElection =
  | "UNDECIDED"
  | "PAY_ON_ACQUISITION"
  | "COLLECT_ON_RENTALS";

export type EngineJurisdiction = {
  id: string;
  code: string;
  name: string;
  administration: "STATE_COLLECTED" | "SELF_COLLECTED";
  rate: { versionId: string; rateMilliPercent: number } | null;
  rules: Partial<Record<TaxChargeCategory, Taxability>>;
};

export type EngineInput = {
  taxDate: Date;
  leaseTermMonths: number | null;
  election: ShortTermLeaseElection;
  defaultRules: Partial<Record<TaxChargeCategory, Taxability>>;
  jurisdictions: EngineJurisdiction[];
  exemptJurisdictionIds: Set<string>;
  lines: {
    key: string;
    kind: InvoiceLineItemKind;
    amountCents: number;
    parentKey?: string;
  }[];
};

export type EngineTaxLine = {
  lineKey: string;
  jurisdictionId: string;
  rateVersionId: string;
  category: TaxChargeCategory;
  taxableCents: number;
  exemptCents: number;
  exemptReason: string | null;
  taxCents: number;
};

export type EngineResult =
  | { ok: true; lines: EngineTaxLine[]; totalTaxCents: number }
  | { ok: false; problems: string[] };

const CATEGORY_WORDS: Record<TaxChargeCategory, string> = {
  RENTAL: "Rental",
  LATE_RETURN: "Late return rent",
  DELIVERY: "Delivery",
  INSTALLATION: "Installation",
  REMOVAL: "Removal",
  DAMAGE_WAIVER: "Damage waiver",
  EARLY_TERMINATION: "Early termination",
  LATE_PAYMENT_FEE: "Late payment fee",
  OTHER_CHARGE: "Other charge",
};

export function resolveTaxability(
  jurisdiction: EngineJurisdiction,
  category: TaxChargeCategory,
  input: Pick<EngineInput, "election" | "defaultRules" | "leaseTermMonths">,
): { taxability: Taxability; reason: string } {
  const specific = jurisdiction.rules[category];

  if (specific && specific !== "UNDECIDED") {
    return {
      taxability: specific,
      reason: `Tax rule configured for ${jurisdiction.name}`,
    };
  }

  if (jurisdiction.administration === "SELF_COLLECTED") {
    return {
      taxability: "UNDECIDED",
      reason: `Tax rule for ${jurisdiction.name} is not decided yet`,
    };
  }

  if (category === "RENTAL" || category === "LATE_RETURN") {
    if (input.election === "PAY_ON_ACQUISITION") {
      if (input.leaseTermMonths === null || input.leaseTermMonths <= 36) {
        return {
          taxability: "EXEMPT",
          reason:
            "Short-term rental — tax paid when the appliance was bought (C.R.S. 39-26-713)",
        };
      }
      return {
        taxability: "TAXABLE",
        reason: "Rental term is longer than 36 months",
      };
    }

    if (input.election === "COLLECT_ON_RENTALS") {
      return {
        taxability: "TAXABLE",
        reason: "Business election collects tax on rental charges",
      };
    }

    return {
      taxability: "UNDECIDED",
      reason: "Short-term lease election is not decided yet",
    };
  }

  const fallback = input.defaultRules[category];
  if (!fallback || fallback === "UNDECIDED") {
    return {
      taxability: "UNDECIDED",
      reason: "Default tax rule is not decided yet",
    };
  }

  return {
    taxability: fallback,
    reason: "Default state-collected tax rule",
  };
}

function resolveLineCategory(
  line: EngineInput["lines"][number],
  byKey: Map<string, EngineInput["lines"][number]>,
  seen: Set<string> = new Set(),
): LineTaxCategory {
  const mapped = categoryForLineKind(line.kind, line.amountCents);
  if (mapped !== "FOLLOWS_PARENT") return mapped;

  if (!line.parentKey) return "RENTAL";
  if (seen.has(line.key)) return "RENTAL";

  const parent = byKey.get(line.parentKey);
  if (!parent) return "RENTAL";

  const nextSeen = new Set(seen);
  nextSeen.add(line.key);
  return resolveLineCategory(parent, byKey, nextSeen);
}

function dateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computeTax(input: EngineInput): EngineResult {
  const problems = new Set<string>();
  const resultLines: EngineTaxLine[] = [];
  const byKey = new Map(input.lines.map((line) => [line.key, line]));

  for (const line of input.lines) {
    const category = resolveLineCategory(line, byKey);
    if (category === "NOT_TAXABLE" || category === "FOLLOWS_PARENT") continue;

    for (const jurisdiction of input.jurisdictions) {
      if (!jurisdiction.rate) {
        problems.add(
          `No rate entered for ${jurisdiction.name} on ${dateLabel(input.taxDate)}`,
        );
      }

      const resolution = resolveTaxability(jurisdiction, category, input);
      if (resolution.taxability === "UNDECIDED") {
        problems.add(
          `${CATEGORY_WORDS[category]} in ${jurisdiction.name}: not decided yet`,
        );
      }

      if (!jurisdiction.rate || resolution.taxability === "UNDECIDED") continue;

      if (input.exemptJurisdictionIds.has(jurisdiction.id)) {
        resultLines.push({
          lineKey: line.key,
          jurisdictionId: jurisdiction.id,
          rateVersionId: jurisdiction.rate.versionId,
          category,
          taxableCents: 0,
          exemptCents: line.amountCents,
          exemptReason: "Customer exemption certificate",
          taxCents: 0,
        });
        continue;
      }

      if (resolution.taxability === "EXEMPT") {
        resultLines.push({
          lineKey: line.key,
          jurisdictionId: jurisdiction.id,
          rateVersionId: jurisdiction.rate.versionId,
          category,
          taxableCents: 0,
          exemptCents: line.amountCents,
          exemptReason: resolution.reason,
          taxCents: 0,
        });
        continue;
      }

      resultLines.push({
        lineKey: line.key,
        jurisdictionId: jurisdiction.id,
        rateVersionId: jurisdiction.rate.versionId,
        category,
        taxableCents: line.amountCents,
        exemptCents: 0,
        exemptReason: null,
        taxCents: taxCentsForLine(
          line.amountCents,
          jurisdiction.rate.rateMilliPercent,
        ),
      });
    }
  }

  if (problems.size > 0) {
    return { ok: false, problems: [...problems] };
  }

  return {
    ok: true,
    lines: resultLines,
    totalTaxCents: resultLines.reduce((sum, line) => sum + line.taxCents, 0),
  };
}
