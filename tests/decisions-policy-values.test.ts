import { $Enums } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  LEASE_ELECTION_VALUES,
  RDF_DECISION_VALUES,
  RDF_HANDLING_VALUES,
  REPORTING_BASIS_VALUES,
  TAXABILITY_VALUES,
  taxPolicyValueProblem,
} from "@/domains/tax/policy-values";
import { TAX_CHARGE_CATEGORIES } from "@/domains/tax/categories";
import { STATE_CELL_CATEGORIES } from "@/domains/decisions/tax-cells";

const sorted = (values: readonly string[]) => [...values].sort();

describe("tax policy value lists match the database", () => {
  it("equal the Prisma enums exactly", () => {
    expect(sorted(TAXABILITY_VALUES)).toEqual(sorted(Object.values($Enums.Taxability)));
    expect(sorted(LEASE_ELECTION_VALUES)).toEqual(sorted(Object.values($Enums.ShortTermLeaseElection)));
    expect(sorted(RDF_HANDLING_VALUES)).toEqual(sorted(Object.values($Enums.RdfHandling)));
    expect(sorted(REPORTING_BASIS_VALUES)).toEqual(sorted(Object.values($Enums.TaxReportingBasis)));
    expect(sorted(TAX_CHARGE_CATEGORIES)).toEqual(sorted(Object.values($Enums.TaxChargeCategory)));
  });

  it("keep the documented string values for the retail delivery fee answer", () => {
    expect(RDF_DECISION_VALUES).toEqual(["UNDECIDED", "NOT_LIABLE", "COLLECT"]);
    expect(taxPolicyValueProblem("retailDeliveryFeeDecision", "COLLECT")).toBeNull();
    expect(taxPolicyValueProblem("retailDeliveryFeeDecision", "PAY_MYSELF")).not.toBeNull();
    expect(taxPolicyValueProblem("rdfHandling", 3)).not.toBeNull();
  });

  it("leaves rent and late-return rent out of the state default questions (they follow the lease choice)", () => {
    expect(STATE_CELL_CATEGORIES).not.toContain("RENTAL");
    expect(STATE_CELL_CATEGORIES).not.toContain("LATE_RETURN");
    expect(STATE_CELL_CATEGORIES).toHaveLength(TAX_CHARGE_CATEGORIES.length - 2);
  });
});
