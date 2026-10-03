import { describe, expect, it } from "vitest";
import { canTransitionAgreementStatus } from "@/domains/agreements";
import { renewalNotStartedException } from "@/domains/exceptions/rules";

describe("scheduled renewal status rules", () => {
  it("a signed renewal can be scheduled, then started or cancelled, and nothing else", () => {
    expect(canTransitionAgreementStatus("AWAITING_SIGNATURE", "SCHEDULED")).toEqual({ ok: true });
    expect(canTransitionAgreementStatus("SCHEDULED", "ACTIVE")).toEqual({ ok: true });
    expect(canTransitionAgreementStatus("SCHEDULED", "CANCELLED")).toEqual({ ok: true });
    expect(canTransitionAgreementStatus("SCHEDULED", "ENDED").ok).toBe(false);
    expect(canTransitionAgreementStatus("SCHEDULED", "DRAFT").ok).toBe(false);
    expect(canTransitionAgreementStatus("ACTIVE", "SCHEDULED").ok).toBe(false);
    expect(canTransitionAgreementStatus("DRAFT", "SCHEDULED").ok).toBe(false);
  });

  it("a renewal that missed its start date shows up as a high-priority item that links to it", () => {
    const item = renewalNotStartedException({
      id: "agr_1",
      startDate: new Date("2027-11-08T07:00:00Z"),
      customerName: "Pat Customer",
    });
    expect(item).toMatchObject({
      category: "RENEWAL_NOT_STARTED",
      severity: "high",
      href: "/desk/agreements/agr_1",
    });
    expect(item.title).toContain("Pat Customer");
  });
});
