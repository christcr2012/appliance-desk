import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: { invoice: { fields: { amountPaidCents: "paid" } } } }));
import type { RentalAgreementStatus } from "@prisma/client";
import {
  AGREEMENT_PILL,
  customerStatus,
  lineTypeNames,
  onTimeRecord,
  rentalBillingLine,
  rentingText,
  settledAt,
} from "@/domains/customers/record";
import { ordinal } from "@/lib/business-date";
import { SUCCESSFUL_PAYMENT_STATUSES } from "@/domains/billing/payment-status";

const at = (iso: string) => new Date(iso);

describe("customer status (first match wins)", () => {
  it.each([
    [{ archivedAt: at("2026-01-01T00:00:00Z"), agreementStatuses: ["ACTIVE"] }, "archived"],
    [{ archivedAt: null, agreementStatuses: ["ENDED", "ACTIVE"] }, "active"],
    [{ archivedAt: null, agreementStatuses: ["SCHEDULED"] }, "upcoming"],
    [{ archivedAt: null, agreementStatuses: ["AWAITING_SIGNATURE", "ENDED"] }, "upcoming"],
    [{ archivedAt: null, agreementStatuses: ["ENDED"] }, "past"],
    [{ archivedAt: null, agreementStatuses: ["DRAFT", "CANCELLED"] }, "new"],
    [{ archivedAt: null, agreementStatuses: [] }, "new"],
  ] as const)("%o → %s", (input, status) => {
    expect(customerStatus({ archivedAt: input.archivedAt, agreementStatuses: [...input.agreementStatuses] as RentalAgreementStatus[] })).toBe(status);
  });
});

describe("renting words", () => {
  it("0, 1, 2, 3+ and the label fallback", () => {
    expect(rentingText([])).toBeNull();
    expect(rentingText(["Washer"])).toBe("Washer");
    expect(rentingText(["Washer", "Dryer", "Washer"])).toBe("Washer + dryer");
    expect(rentingText(["Washer", "Dryer", "Fridge"])).toBe("3 appliances");
    expect(lineTypeNames({ label: "Washer/Dryer set @ $60/mo", assignments: [] })).toEqual(["Washer/Dryer set"]);
    expect(lineTypeNames({ label: "x", assignments: [{ appliance: { applianceType: { name: "Dryer" } } }] })).toEqual(["Dryer"]);
  });
});

describe("pays on time", () => {
  const due = at("2026-10-20T06:00:00Z"); // Oct 20, Colorado midnight (MDT)
  it("fewer than 3 bills → null", () => {
    expect(onTimeRecord([{ dueDate: due, paidAt: due }, { dueDate: due, paidAt: due }])).toBeNull();
    expect(onTimeRecord([{ dueDate: null, paidAt: due }, { dueDate: due, paidAt: due }, { dueDate: due, paidAt: due }])).toBeNull();
  });
  it("23:59 on the due day is on time; 00:01 the next day is late; unpaid counts as late", () => {
    const onTime = at("2026-10-21T05:59:00Z");
    const late = at("2026-10-21T06:01:00Z");
    expect(onTimeRecord([{ dueDate: due, paidAt: onTime }, { dueDate: due, paidAt: late }, { dueDate: due, paidAt: null }])).toEqual({ paidOnTime: 1, counted: 3 });
  });
  it("works across the November DST change", () => {
    const nov1 = at("2026-11-01T06:00:00Z"); // Nov 1 starts in MDT; the day ends at 07:00Z (MST)
    expect(onTimeRecord([{ dueDate: nov1, paidAt: at("2026-11-02T06:30:00Z") }, { dueDate: nov1, paidAt: at("2026-11-02T07:01:00Z") }, { dueDate: nov1, paidAt: nov1 }])).toEqual({ paidOnTime: 2, counted: 3 });
  });
  it("settlement date: payments by the day money arrived plus credit; half early payment + late credit is late", () => {
    // A check received on the due date but recorded 4 days later counts by its received date.
    expect(settledAt(7000, [{ at: due, amountCents: 7000 }])).toEqual(due);
    // Paid entirely with credit on time.
    expect(settledAt(7000, [{ at: at("2026-10-19T12:00:00Z"), amountCents: 7000 }])).toEqual(at("2026-10-19T12:00:00Z"));
    // Half early, half by late credit → the late date.
    expect(settledAt(7000, [{ at: at("2026-10-25T12:00:00Z"), amountCents: 3500 }, { at: at("2026-10-15T12:00:00Z"), amountCents: 3500 }])).toEqual(at("2026-10-25T12:00:00Z"));
    expect(settledAt(7000, [{ at: due, amountCents: 100 }])).toBeNull();
    // Both payment spellings count as successful (recordManualPayment writes lowercase "succeeded").
    expect(SUCCESSFUL_PAYMENT_STATUSES).toEqual(expect.arrayContaining(["succeeded", "SUCCEEDED"]));
  });
});

describe("rental pills and billing line", () => {
  it("covers every rental status", () => {
    const now = at("2026-10-25T18:00:00Z");
    expect(Object.keys(AGREEMENT_PILL).sort()).toEqual(["ACTIVE", "AWAITING_SIGNATURE", "CANCELLED", "DRAFT", "ENDED", "SCHEDULED"]);
    expect(AGREEMENT_PILL.SCHEDULED(at("2026-11-02T18:00:00Z"), now)).toEqual({ label: "Starts Nov 2", tone: "info" });
    expect(AGREEMENT_PILL.AWAITING_SIGNATURE(null, now)).toEqual({ label: "Waiting for signature", tone: "info" });
  });
  it("blocked, automatic (with and without autopay) and not started", () => {
    const common = { agreementId: "a1", rentCents: 7000, nextBillingDate: at("2026-11-03T18:00:00Z") };
    expect(rentalBillingLine({ ...common, billingBlockedReason: "TAX_SETUP", stripeSubscriptionId: "sub", autopay: true })).toEqual({
      kind: "blocked",
      text: "Monthly billing isn't running for this rental.",
      href: "/desk/agreements/a1",
    });
    expect(rentalBillingLine({ ...common, billingBlockedReason: null, stripeSubscriptionId: "sub", autopay: true }).text).toBe(
      "Automatic: $70.00 is billed and charged to the card on file on the 3rd of each month.",
    );
    expect(rentalBillingLine({ ...common, billingBlockedReason: null, stripeSubscriptionId: "sub", autopay: false }).text).toBe(
      "Automatic: a $70.00 bill is made on the 3rd of each month.",
    );
    expect(rentalBillingLine({ ...common, billingBlockedReason: null, stripeSubscriptionId: null, autopay: true })).toEqual({
      kind: "not-started",
      text: "Monthly billing hasn't started yet.",
    });
  });
  it("ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });
});
