import { computeTax, resolveTaxability, type EngineInput, type EngineTaxLine } from "@/domains/tax/engine";

export type SetupTaxRule = {
  category: "ADMINISTRATIVE_SETUP";
  jurisdictionId: string | null;
  taxability: "TAXABLE" | "EXEMPT" | "UNDECIDED";
  cpaConfirmedOn: Date | null;
};

export type SigningFeeTaxInput = {
  setupFeeCents: number;
  downPaymentCents: number;
  setupFeeTaxTreatment: string;
  context: Omit<EngineInput, "lines">;
  rules: readonly SetupTaxRule[];
};

export type SigningFeeTaxReview = {
  status: "REVIEW_REQUIRED" | "CALCULATED_DRAFT";
  reasons: string[];
  setupTaxCents: number | null;
  candidateSigningTotalCents: number | null;
  jurisdictionLines: EngineTaxLine[];
  eligibleForCollection: false;
};

function blocked(reasons: string[]): SigningFeeTaxReview {
  return { status: "REVIEW_REQUIRED", reasons: [...new Set(reasons)],
    setupTaxCents: null, candidateSigningTotalCents: null,
    jurisdictionLines: [], eligibleForCollection: false };
}

/** Private candidate only. A first-month down payment is a credit, not a
 * second taxable rental line. Actual rental tax belongs on the first invoice. */
export function reviewSigningFeeTax(input: SigningFeeTaxInput): SigningFeeTaxReview {
  const { setupFeeCents, downPaymentCents, setupFeeTaxTreatment, context, rules } = input;
  const reasons: string[] = [];
  if (![setupFeeCents, downPaymentCents, setupFeeCents + downPaymentCents]
      .every((value) => Number.isSafeInteger(value) && value >= 0)) {
    reasons.push("Signing amounts must be nonnegative safe integer cents.");
  }
  if (!(context.taxDate instanceof Date) || !Number.isFinite(context.taxDate.getTime())) {
    reasons.push("A valid effective tax date is required.");
  }
  if (reasons.length) return blocked(reasons);
  if (setupFeeCents === 0) {
    return { status: "CALCULATED_DRAFT", reasons: [], setupTaxCents: 0,
      candidateSigningTotalCents: downPaymentCents,
      jurisdictionLines: [], eligibleForCollection: false };
  }
  if (!["TAXABLE", "NOT_TAXABLE"].includes(setupFeeTaxTreatment)) {
    reasons.push("Administrative setup fee tax treatment is undecided (IN-79).");
  }
  if (context.jurisdictions.length === 0) {
    reasons.push("No verified service-address tax jurisdictions were found.");
  }
  const visited = new Set<string>();
  for (const jurisdiction of context.jurisdictions) {
    if (visited.has(jurisdiction.id)) {
      reasons.push(`Duplicate tax jurisdiction ${jurisdiction.name}.`);
      continue;
    }
    visited.add(jurisdiction.id);
    const localRule = rules.find((rule) => rule.jurisdictionId === jurisdiction.id);
    const proof = localRule ?? (jurisdiction.administration === "STATE_COLLECTED"
      ? rules.find((rule) => rule.jurisdictionId === null) : undefined);
    const effective = resolveTaxability(jurisdiction, "ADMINISTRATIVE_SETUP", context);
    if (!proof || proof.category !== "ADMINISTRATIVE_SETUP" || proof.taxability === "UNDECIDED" || !proof.cpaConfirmedOn ||
        !Number.isFinite(proof.cpaConfirmedOn.getTime()) ||
        proof.cpaConfirmedOn > context.taxDate || effective.taxability !== proof.taxability) {
      reasons.push(`Independent CPA-confirmed setup-fee tax treatment is missing for ${jurisdiction.name}.`);
    } else if (setupFeeTaxTreatment === "NOT_TAXABLE" && proof.taxability === "TAXABLE" &&
        !context.exemptJurisdictionIds.has(jurisdiction.id)) {
      reasons.push(`Setup-fee configuration conflicts with the confirmed rule for ${jurisdiction.name}.`);
    }
  }
  if (reasons.length) return blocked(reasons);
  const computation = computeTax({ ...context, lines: [{
    key: "administrative-setup", kind: "ADMIN_SETUP_FEE", amountCents: setupFeeCents,
  }] });
  if (!computation.ok) return blocked(computation.problems);
  const total = setupFeeCents + downPaymentCents + computation.totalTaxCents;
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(computation.totalTaxCents) || computation.totalTaxCents < 0) {
    return blocked(["The tax-inclusive amount exceeds the permitted money range."]);
  }
  return {
    status: "CALCULATED_DRAFT", reasons: [], setupTaxCents: computation.totalTaxCents,
    candidateSigningTotalCents: total, jurisdictionLines: computation.lines,
    eligibleForCollection: false,
  };
}
