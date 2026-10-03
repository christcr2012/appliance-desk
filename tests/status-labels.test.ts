import {
  EstimateStatus,
  InvoiceStatus,
  JobStatus,
  JobType,
  MaintenanceStatus,
  RentalAgreementStatus,
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  estimateStatusLabel,
  invoiceStatusLabel,
  jobStatusLabel,
  jobTypeLabel,
  maintenanceStatusLabel,
  rentalAgreementStatusLabel,
} from "@/lib/status-labels";

function expectCompleteLabels<T extends string>(
  values: Record<string, T>,
  expected: Record<T, string>,
  label: (value: string) => string,
) {
  expect(new Set(Object.keys(expected))).toEqual(new Set(Object.values(values)));
  for (const value of Object.values(values)) {
    expect(label(value), `customer-facing label for ${value}`).toBe(expected[value]);
    expect(label(value), `raw enum leaked for ${value}`).not.toBe(value);
  }
}

describe("customer-facing status labels", () => {
  it("covers every RentalAgreementStatus value", () => {
    const expected: Record<RentalAgreementStatus, string> = {
      DRAFT: "Being set up",
      AWAITING_SIGNATURE: "Waiting on your signature",
      SCHEDULED: "Signed, starts later",
      ACTIVE: "Active",
      ENDED: "Ended",
      CANCELLED: "Cancelled",
    };
    expectCompleteLabels(RentalAgreementStatus, expected, rentalAgreementStatusLabel);
  });

  it("covers every JobStatus value", () => {
    const expected: Record<JobStatus, string> = {
      SCHEDULED: "Scheduled",
      IN_PROGRESS: "In progress",
      COMPLETED: "Completed",
      CANCELLED: "Cancelled",
    };
    expectCompleteLabels(JobStatus, expected, jobStatusLabel);
  });

  it("covers every JobType value shown to customers", () => {
    const expected: Record<JobType, string> = {
      DELIVERY: "Delivery",
      INSTALLATION: "Installation",
      SWAP: "Swap",
      MAINTENANCE_VISIT: "Maintenance visit",
      REMOVAL: "Pickup / removal",
    };
    expectCompleteLabels(JobType, expected, jobTypeLabel);
  });

  it("covers every MaintenanceStatus value", () => {
    const expected: Record<MaintenanceStatus, string> = {
      SUBMITTED: "Submitted",
      REVIEWING: "Being reviewed",
      SCHEDULED: "Scheduled",
      IN_PROGRESS: "In progress",
      RESOLVED: "Resolved",
      CLOSED: "Closed",
    };
    expectCompleteLabels(MaintenanceStatus, expected, maintenanceStatusLabel);
  });

  it("covers every InvoiceStatus value", () => {
    const expected: Record<InvoiceStatus, string> = {
      DRAFT: "Being prepared",
      OPEN: "Open",
      PARTIALLY_PAID: "Partially paid",
      PAID: "Paid",
      FAILED: "Payment failed",
      VOID: "Voided",
      DELINQUENT: "Past due",
      WRITTEN_OFF: "Written off",
      REFUNDED: "Refunded",
    };
    expectCompleteLabels(InvoiceStatus, expected, invoiceStatusLabel);
  });

  it("covers every EstimateStatus value", () => {
    const expected: Record<EstimateStatus, string> = {
      DRAFT: "Being prepared",
      SENT: "Sent — awaiting your response",
      VIEWED: "Sent — awaiting your response",
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
      DECLINED: "Declined",
      EXPIRED: "Expired",
      CONVERTED: "Approved and set up",
    };
    expectCompleteLabels(EstimateStatus, expected, estimateStatusLabel);
  });

  it("keeps the deliberate unknown-value fallback", () => {
    expect(invoiceStatusLabel("FUTURE_STATUS")).toBe("FUTURE_STATUS");
  });
});
