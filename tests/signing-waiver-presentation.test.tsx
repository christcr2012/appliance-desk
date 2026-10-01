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
