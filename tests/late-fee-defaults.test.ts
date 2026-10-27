import { describe, expect, it, vi } from "vitest";

// DEC-2: a new agreement starts with the late fee in Settings; a renewal keeps what the old agreement says.
vi.mock("next/navigation", () => import("./kit/kit-test-env"));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ requireRole: async () => ({ user: { id: "u1", role: "OWNER" } }) }));
vi.mock("@/app/desk/agreements/actions", () => ({
  createDraftAgreementAction: vi.fn(), addRentalLineAction: vi.fn(), removeRentalLineAction: vi.fn(),
  activateAgreementAction: vi.fn(), sendForSignatureAction: vi.fn(), updateDraftTermsAction: vi.fn(),
}));
vi.mock("@/app/desk/customers/actions", () => ({ createCustomerAction: vi.fn() }));

import { createDraftAgreementInTx, lateFeeTermsForNewAgreement } from "@/domains/agreements";
import { renewalCreateData } from "@/domains/agreements/renewal-data";

const SETTINGS = {
  twelveMonthPrepayFreeMonthEnabled: false, draftReservationHoldDays: 7,
  lateFeeGraceDays: 10, lateFeeFlatCents: 500, lateFeePercent: 0,
};

describe("late fee terms for a new agreement", () => {
  it("take the amount, days and percent from Settings when the form leaves them out", () => {
    expect(lateFeeTermsForNewAgreement({}, SETTINGS)).toEqual({ lateFeeGraceDays: 10, lateFeeCents: 500, lateFeePercent: 0 });
    expect(lateFeeTermsForNewAgreement({}, { ...SETTINGS, lateFeeGraceDays: 14, lateFeeFlatCents: 1000, lateFeePercent: 2 }))
      .toEqual({ lateFeeGraceDays: 14, lateFeeCents: 1000, lateFeePercent: 2 });
  });

  it("keep what the person typed, including a deliberate zero", () => {
    expect(lateFeeTermsForNewAgreement({ lateFeeCents: 0, lateFeeGraceDays: 12, lateFeePercent: 0 }, SETTINGS))
      .toEqual({ lateFeeGraceDays: 12, lateFeeCents: 0, lateFeePercent: 0 });
  });

  it("never go below 10 days or above $15, whatever the setting says", () => {
    expect(lateFeeTermsForNewAgreement({}, { ...SETTINGS, lateFeeGraceDays: 3, lateFeeFlatCents: 9900 }))
      .toEqual({ lateFeeGraceDays: 10, lateFeeCents: 1500, lateFeePercent: 0 });
  });

  it("fall back to the starting terms (10 days, no fee) when no settings are given", () => {
    expect(lateFeeTermsForNewAgreement({}, {})).toEqual({ lateFeeGraceDays: 10, lateFeeCents: 0, lateFeePercent: 0 });
  });
});

describe("creating a draft agreement", () => {
  function fakeTx() {
    const created: Record<string, unknown>[] = [];
    const tx = {
      serviceAddress: { findUnique: vi.fn(async () => ({ customerId: "c1", state: "CO", city: "Greeley", customer: { archivedAt: null } })) },
      // FEETAX-2: the draft save runs the delivery readiness check; the
      // fake address is confirmed into the state-collected jurisdiction.
      addressTaxLocation: { findFirst: vi.fn(async () => ({ status: "VERIFIED", jurisdictions: [{ jurisdiction: { id: "tax-jurisdiction-co", name: "State of Colorado", level: "STATE", administration: "STATE_COLLECTED" } }] })) },
      jurisdictionReadiness: { findUnique: vi.fn(async () => null) },
      auditLog: { create: vi.fn(async () => ({})) },
      rentalAgreement: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (created.push(data), { id: "a1", ...data })) },
    };
    return { tx: tx as never, created };
  }
  const input = { customerId: "c1", serviceAddressId: "s1" };

  it("a draft with no fee typed gets $5 from Settings", async () => {
    const { tx, created } = fakeTx();
    await createDraftAgreementInTx(tx, "u1", input, { settings: SETTINGS });
    expect(created[0]).toMatchObject({ lateFeeCents: 500, lateFeeGraceDays: 10, lateFeePercent: 0 });
  });

  it("a quote turned into a rental starts with the Settings fee too", async () => {
    const { tx, created } = fakeTx();
    await createDraftAgreementInTx(tx, "u1", { ...input, depositCents: 2500 }, { sourceEstimateId: "e1", settings: SETTINGS });
    expect(created[0]).toMatchObject({ lateFeeCents: 500, depositCents: 2500, sourceEstimateId: "e1" });
  });

  it("a typed fee wins over Settings", async () => {
    const { tx, created } = fakeTx();
    await createDraftAgreementInTx(tx, "u1", { ...input, lateFeeCents: 300 }, { settings: SETTINGS });
    expect(created[0]).toMatchObject({ lateFeeCents: 300 });
  });
});

describe("a renewal", () => {
  it("keeps the old agreement's late fee terms even after Settings changes", () => {
    const data = renewalCreateData({
      customerId: "c1", serviceAddressId: "s1", damageWaiverCents: 0, lateFeeGraceDays: 12, lateFeeCents: 0, lateFeePercent: 1,
      endDate: new Date("2026-12-31T12:00:00Z"), id: "old", continuityRootId: null, continuousSince: null,
      firstDeliveredOn: new Date("2026-01-05T12:00:00Z"),
    }, [], { termMonths: 12 });
    expect(data).toMatchObject({ lateFeeGraceDays: 12, lateFeeCents: 0, lateFeePercent: 1 });
  });
});

describe("the new rental form", () => {
  it("opens with the Settings fee and days filled in, so the owner sees what the agreement will say", async () => {
    const { initialTermFields } = await import("@/app/desk/agreements/new/rental-wizard");
    expect(initialTermFields(undefined, { graceDays: 10, cents: 500, percent: 0 }))
      .toMatchObject({ lateFeeDollars: "5", lateFeeGraceDays: "10", lateFeePercent: "" });
    expect(initialTermFields(undefined)).toMatchObject({ lateFeeDollars: "", lateFeeGraceDays: "10" });
  });

  it("a saved draft keeps its own terms, not Settings", async () => {
    const { initialTermFields } = await import("@/app/desk/agreements/new/rental-wizard");
    const draft = {
      id: "d", customerId: "c", customerName: "C", serviceAddressId: "s", termMonths: 12, depositCents: 0,
      damageWaiverCents: 0, lateFeeGraceDays: 12, lateFeeCents: 300, lateFeePercent: 0, paidInFullInAdvance: false, lines: [],
    };
    expect(initialTermFields(draft, { graceDays: 10, cents: 500, percent: 0 }))
      .toMatchObject({ lateFeeDollars: "3", lateFeeGraceDays: "12" });
  });
});
