import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ portal: vi.fn() }));
vi.mock("@/lib/session", () => ({ getServerSession: async () => ({ user: { id: "customer-user" } }) }));
vi.mock("@/domains/portal", () => ({ getPortalRentals: m.portal, PORTAL_PAGE_SIZE: 20 }));
import AccountRentalsPage from "@/app/account/rentals/page";
afterEach(cleanup);

it.each(["DRAFT", "AWAITING_SIGNATURE", "ACTIVE"])("does not report configured deposit terms as paid for a %s agreement", async (status) => {
  m.portal.mockResolvedValue({ customerId: "c", jobs: [], hasMoreJobs: false, agreements: [{ id: "agreement", status,
    serviceAddress: { line1: "100 Test St", city: "Denver" }, termMonths: 12,
    freeMonthGranted: false, depositCents: 15000, monthlyTotalCents: 4000,
    renewalPreference: null, terminationRequestedAt: null, terminationEffectiveOn: null, nextBillingDate: null,
    terms: { ending: null, autoRenew: null }, autoRenewAgreed: false, renewalStartsOn: null, nextVisit: null, hasSignedCopy: false,
    lines: [{ id: "line", label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4000,
      prepayDiscountCentsPerMonth: 0, appliances: [] }],
  }] });
  render(await AccountRentalsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Deposit required: $150")).toBeVisible();
  expect(screen.queryByText(/deposit.*paid/i)).toBeNull();
  expect(m.portal).toHaveBeenCalledWith("customer-user", { jobLimit: 20 });
});
