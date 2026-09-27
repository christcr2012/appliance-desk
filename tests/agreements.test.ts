import { describe, it, expect } from "vitest";
import { canTransitionAgreementStatus, isReservationStale } from "@/domains/agreements";

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

// isReservationStale is the pure check behind Phase 6A item 6
// (reservation aging) — see docs/DECISIONS.md's dated design decision
// and src/domains/agreements/reservation-status.ts's own doc comment
// for why it lives in its own zero-database-import submodule.
describe("isReservationStale", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const past = new Date("2026-06-01T00:00:00Z"); // before `now`
  const future = new Date("2026-07-01T00:00:00Z"); // after `now`

  it("is stale for a DRAFT agreement whose hold has expired", () => {
    expect(isReservationStale("DRAFT", past, now)).toBe(true);
  });

  it("is stale for an AWAITING_SIGNATURE agreement whose hold has expired", () => {
    expect(isReservationStale("AWAITING_SIGNATURE", past, now)).toBe(true);
  });

  it("is not stale while the hold is still in the future", () => {
    expect(isReservationStale("DRAFT", future, now)).toBe(false);
  });

  it("is never stale once an agreement is ACTIVE, ENDED, or CANCELLED — the hold no longer applies", () => {
    expect(isReservationStale("ACTIVE", past, now)).toBe(false);
    expect(isReservationStale("ENDED", past, now)).toBe(false);
    expect(isReservationStale("CANCELLED", past, now)).toBe(false);
  });

  it("is never stale with no reservationExpiresAt set at all", () => {
    expect(isReservationStale("DRAFT", null, now)).toBe(false);
  });
});
