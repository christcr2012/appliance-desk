import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ portal: vi.fn() }));
vi.mock("@/lib/session", () => ({ getServerSession: async () => ({ user: { id: "customer-user" } }) }));
vi.mock("@/domains/portal", () => ({ getPortalData: m.portal }));
import AccountRentalsPage from "@/app/account/rentals/page";
afterEach(cleanup);

const agreement = {
  id: "agreement", status: "DRAFT", serviceAddress: { line1: "100 Test St", city: "Greeley" },
  termMonths: 12, startDate: null, terminationRequestedAt: null,
  terminationEffectiveOn: null, termsSnapshot: null, renewalPreference: null,
  jobs: [], freeMonthGranted: false, depositCents: 0,
  lines: [{ id: "line", label: "Washer", monthlyPriceCents: 4000,
    listPriceCents: 4000, prepayDiscountCentsPerMonth: 0, assignments: [] }],
};
it.each(["AWAITING_PAYMENT", "RECEIVED", "REVIEW_REQUIRED"] as const)(
  "customer Rentals page renders isolated %s signing evidence without inventing invoice payment",
  async (status) => {
    m.portal.mockResolvedValue({ jobs: [], jobsHasMore: false,
      rentalAgreements: [{ ...agreement, signingPaymentSummary: {
        setupFeeCents: status === "REVIEW_REQUIRED" ? null : 4500,
        setupTaxCents: status === "REVIEW_REQUIRED" ? null : 300,
        downPaymentCents: status === "REVIEW_REQUIRED" ? null : 4000,
        totalCents: status === "REVIEW_REQUIRED" ? null : 8800,
        status, receivedOn: status === "RECEIVED" ? new Date("2026-10-14T12:00:00Z") : null,
      } }],
    });
    render(await AccountRentalsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("region", { name: "Signing payment" })).toBeVisible();
    if (status === "REVIEW_REQUIRED") {
      expect(screen.getByText("Signing payment needs review")).toBeVisible();
      expect(screen.queryByText("Signed signing amount")).toBeNull();
    } else {
      expect(screen.getByText("Signed signing amount")).toBeVisible();
      expect(screen.getByText("$88")).toBeVisible();
      expect(screen.getByText(/Money received at signing is separate/)).toBeVisible();
    }
  },
);
