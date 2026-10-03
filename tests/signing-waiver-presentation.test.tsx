import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ signature: vi.fn() }));
vi.mock("@/domains/agreements", () => ({ getSignatureRecordForSigning: m.signature }));
vi.mock("@/app/sign/[id]/sign-form", () => ({ SignForm: () => null }));
import SignPage from "@/app/sign/[id]/page";
afterEach(cleanup);
it("shows the frozen waiver once at signing while leaving rental rates monthly", async () => {
  m.signature.mockResolvedValue({ id: "sig", agreement: {
    customer: { user: { name: "Customer", email: "customer@example.test" } },
    serviceAddress: { line1: "123 Test", city: "Greeley", state: "CO", zip: "80631" },
    termMonths: 12, lines: [{ id: "line", label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4500, prepayDiscountCentsPerMonth: 500 }],
    freeMonthGranted: true, depositCents: 10000, damageWaiverCents: 1500,
    lateFeeCents: 0, lateFeePercent: 0,
  } });
  render(await SignPage({ params: Promise.resolve({ id: "sig" }) }));
  expect(screen.getByText("Damage waiver: $15 once at signing")).toBeVisible();
  expect(screen.getByText("Total: $40/month")).toBeVisible();
  expect(screen.queryByText(/Damage waiver:.*\/month/)).toBeNull();
});

const baseAgreement = {
  customer: { user: { name: "Customer", email: "customer@example.test" } },
  serviceAddress: { line1: "123 Test", city: "Greeley", state: "CO", zip: "80631" },
  lines: [{ id: "line", label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4000, prepayDiscountCentsPerMonth: 0 }],
  freeMonthGranted: false, depositCents: 0, damageWaiverCents: 0, lateFeeCents: 0, lateFeePercent: 0,
};
const lockedSnapshot = {
  shape: 1, source: "SYSTEM", capturedAt: "2026-10-03T00:00:00.000Z",
  termination: { feeCents: 5000, feePercent: 10, feeCapCents: 20000, noticeDays: 30, unusedTerm: "CREDIT", termsText: "Owner wording about ending early." },
  autoRenew: { noticeDays: 45, termsText: "Owner wording about renewing.", termsVersion: "ar-abc" },
};

it("shows the locked ending and renewal terms before the signature box", async () => {
  m.signature.mockResolvedValue({ id: "sig", agreement: { ...baseAgreement, termMonths: 12, termsSnapshot: lockedSnapshot } });
  render(await SignPage({ params: Promise.resolve({ id: "sig" }) }));
  expect(screen.getByRole("heading", { name: "Ending this agreement early" })).toBeVisible();
  expect(screen.getByText(/the larger of \$50 or 10% of the remaining rent, never more than \$200/)).toBeVisible();
  expect(screen.getByText("Notice needed to end early: 30 days.")).toBeVisible();
  expect(screen.getByText(/becomes a credit on your account/)).toBeVisible();
  expect(screen.getByText("Owner wording about ending early.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Automatic renewal" })).toBeVisible();
  expect(screen.getByText("You can opt out of automatic renewal with 45 days notice.")).toBeVisible();
  expect(screen.getByText("Owner wording about renewing.")).toBeVisible();
});

it("shows no ending or renewal section when those terms were never agreed", async () => {
  m.signature.mockResolvedValue({ id: "sig", agreement: { ...baseAgreement, termMonths: 6, termsSnapshot: { ...lockedSnapshot, termination: null, autoRenew: null } } });
  render(await SignPage({ params: Promise.resolve({ id: "sig" }) }));
  expect(screen.queryByText("Ending this agreement early")).toBeNull();
  expect(screen.queryByText("Automatic renewal")).toBeNull();
});

it("shows no locked terms on a month-to-month agreement or an older one with no snapshot", async () => {
  m.signature.mockResolvedValue({ id: "sig", agreement: { ...baseAgreement, termMonths: null, termsSnapshot: lockedSnapshot } });
  render(await SignPage({ params: Promise.resolve({ id: "sig" }) }));
  expect(screen.queryByText("Ending this agreement early")).toBeNull();
  cleanup();
  m.signature.mockResolvedValue({ id: "sig", agreement: { ...baseAgreement, termMonths: 12, termsSnapshot: null } });
  render(await SignPage({ params: Promise.resolve({ id: "sig" }) }));
  expect(screen.queryByText("Ending this agreement early")).toBeNull();
});
