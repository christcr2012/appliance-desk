import { describe, expect, it } from "vitest";
import { businessDateFromKey } from "@/lib/business-date";
import { taxAmendmentDueException, taxFilingNotReadyException } from "@/domains/exceptions/rules";
import { businessDateFromKey } from "@/lib/business-date";
import { taxReturnDueException, taxLicenseRenewalException } from "@/domains/exceptions/rules";
const day = (s: string): Date => businessDateFromKey(s)!;

describe("filing Today exception rules", () => {
  it("shows after the filing period with increased urgency close to legal deadline", () => {
    const input = {
      accountName: "Greeley",
      periodEnd: day("2026-09-30"),
      dueOn: day("2026-10-20"),
      legalDueOn: day("2026-10-20"),
      zeroReturn: true,
      readOnly: false,
      reminderDaysBefore: [7, 2],
    };
    const earlier = taxReturnDueException({ ...input, now: day("2026-10-01") });
    expect(earlier.category).toBe("TAX_RETURN_DUE");
    expect(earlier.severity).toBe("medium");
    expect(earlier.detail).toContain("zero return");
    expect(taxReturnDueException({ ...input, now: day("2026-10-17") }).severity).toBe("medium");
    expect(taxReturnDueException({ ...input, now: day("2026-10-18") }).severity).toBe("high");
    expect(taxReturnDueException({ ...input, now: day("2026-10-17"), reminderDaysBefore: [14, 3] }).severity).toBe("high");
    expect(taxReturnDueException({ ...input, now: day("2026-10-21") }).title).toContain("overdue");
    expect(taxReturnDueException({ ...input, now: day("2026-10-21"), readOnly: true }).detail).toContain("Only the Owner");
  });

  it("shows license warnings 60 days before expiration, distinguishing ADMIN read-only wording", () => {
    const item = taxLicenseRenewalException({
      accountName: "State", expiresOn: day("2026-11-01"),
      now: day("2026-10-26"), readOnly: true,
    });
    expect(item.category).toBe("TAX_LICENSE_RENEWAL");
    expect(item.severity).toBe("high");
    expect(item.detail).toContain("Ask an Owner");
  });
});


describe("T-6b2 filing amendment and readiness attention", () => {
  const day = (key: string) => businessDateFromKey(key)!;
  it("escalates additional tax and preserves original amendment age", () => {
    const input = { id: "am-1", accountName: "Greeley", detectedAt: day("2026-10-05") };
    expect(taxAmendmentDueException({ ...input, additionalTaxCents: 43 }).severity).toBe("high");
    expect(taxAmendmentDueException({ ...input, additionalTaxCents: -8 }).severity).toBe("medium");
    expect(taxAmendmentDueException({ ...input, additionalTaxCents: 0 }).href).toBe("/desk/today");
  });
  it("escalates blocked returns near due date", () => {
    const data = { accountName: "State", periodEnd: day("2026-09-30"),
      dueOn: day("2026-10-20"), problems: ["CPA basis is undecided"] };
    expect(taxFilingNotReadyException({ ...data, now: day("2026-10-01") }).severity).toBe("medium");
    expect(taxFilingNotReadyException({ ...data, now: day("2026-10-18") }).severity).toBe("high");
    expect(taxFilingNotReadyException({ ...data, now: day("2026-10-18") }).detail).toContain("CPA basis");
  });
});
