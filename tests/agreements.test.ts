import { describe, it, expect } from "vitest";
import { canTransitionAgreementStatus } from "@/domains/agreements";

// canTransitionAgreementStatus is the pure rule closeAgreement (and the
// DRAFT -> AWAITING_SIGNATURE -> ACTIVE flow) enforces server-side — see
// docs/BUSINESS-RULES.md's rental-agreement flow. Pure and exported
// specifically so it's unit-testable despite the rest of that file
// needing a real database.
describe("canTransitionAgreementStatus", () => {
  it("allows sending a draft for signature", () => {
    expect(canTransitionAgreementStatus("DRAFT", "AWAITING_SIGNATURE")).toEqual({
      ok: true,
    });
  });

  it("allows a signed (awaiting-signature) agreement to go active", () => {
    expect(canTransitionAgreementStatus("AWAITING_SIGNATURE", "ACTIVE")).toEqual({
      ok: true,
    });
  });

  it("allows ending an active agreement", () => {
    expect(canTransitionAgreementStatus("ACTIVE", "ENDED")).toEqual({ ok: true });
  });

  it("allows cancelling from draft, awaiting signature, or active", () => {
    expect(canTransitionAgreementStatus("DRAFT", "CANCELLED").ok).toBe(true);
    expect(canTransitionAgreementStatus("AWAITING_SIGNATURE", "CANCELLED").ok).toBe(
      true,
    );
    expect(canTransitionAgreementStatus("ACTIVE", "CANCELLED").ok).toBe(true);
  });

  it("rejects moving to the same status", () => {
    expect(canTransitionAgreementStatus("DRAFT", "DRAFT").ok).toBe(false);
  });

  it("rejects any transition out of ended or cancelled — both are terminal", () => {
    expect(canTransitionAgreementStatus("ENDED", "ACTIVE").ok).toBe(false);
    expect(canTransitionAgreementStatus("CANCELLED", "DRAFT").ok).toBe(false);
  });

  it("rejects skipping straight from draft to active without a signature", () => {
    expect(canTransitionAgreementStatus("DRAFT", "ACTIVE").ok).toBe(false);
  });
});
