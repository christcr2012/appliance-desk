import { describe, it, expect } from "vitest";
import {
  agreementTermExpiredException,
  applianceMaintenanceDueException,
  billingBlockedException,
  missingRepairCostException,
  overdueJobException,
  pastDueInvoiceException,
  sortExceptions,
  staleReservationException,
  stripeTaxMismatchException,
  stripeTaxUnverifiedException,
  taxExemptionExpiryException,
  taxExemptionExpiryWindow,
  taxExemptionWarningSince,
  taxAddressChangedException,
  taxRateReviewReminderException,
  uninspectedReturnException,
  unreviewedMaintenanceRequestException,
  type ExceptionItem,
} from "@/domains/exceptions/rules";

// Pure rules for the exception inbox (2026-09-28, /desk/today) — see
// src/domains/exceptions/index.ts for the real DB queries that feed these.

describe("exception builders", () => {
  it("billingBlockedException carries the agreement's own recorded reason and links to it", () => {
    const item = billingBlockedException({
      id: "agr-1",
      billingBlockedReason: "Couldn't start billing: Your card was declined.",
      updatedAt: new Date("2026-09-20"),
      customerName: "Jane Doe",
    });
    expect(item.category).toBe("BILLING_BLOCKED");
    expect(item.severity).toBe("high");
    expect(item.detail).toBe("Couldn't start billing: Your card was declined.");
    expect(item.href).toBe("/desk/agreements/agr-1");
  });

  it("stripeTaxMismatchException keeps the mismatch in the shared Sales tax category and links to the bill", () => {
    const item = stripeTaxMismatchException({
      id: "inv-tax-1",
      invoiceNumber: 42,
      customerId: "cust-tax-1",
      customerName: "Jane Doe",
      since: new Date("2026-10-07"),
      stripeTaxCents: 291,
      engineTaxCents: 292,
    });
    expect(item.category).toBe("SALES_TAX");
    expect(item.severity).toBe("high");
    expect(item.title).toContain("Bill #42");
    expect(item.detail).toContain("291");
    expect(item.detail).toContain("292");
    expect(item.href).toBe("/desk/billing/customer/cust-tax-1/invoice/inv-tax-1");
  });

  it("stripeTaxUnverifiedException explains that Stripe money recorded but tax needs review", () => {
    const item = stripeTaxUnverifiedException({
      id: "inv-tax-2",
      invoiceNumber: 43,
      customerId: "cust-tax-1",
      customerName: "Jane Doe",
      since: new Date("2026-10-07"),
      problems: ["Tax setup was not ready for this invoice date."],
    });
    expect(item.category).toBe("SALES_TAX");
    expect(item.severity).toBe("high");
    expect(item.title).toContain("Bill #43");
    expect(item.title).toContain("could not be verified");
    expect(item.detail).toContain("not ready");
    expect(item.href).toBe("/desk/billing/customer/cust-tax-1/invoice/inv-tax-2");
  });

  it("taxExemptionExpiryException stays in Sales tax and links to the customer billing tab", () => {
    const item = taxExemptionExpiryException({
      customerId: "cust-exempt-1",
      customerName: "Jane Doe",
      expiresOn: new Date("2026-11-06T06:59:59.000Z"),
      warningSince: new Date("2026-10-07T06:59:59.000Z"),
    });
    expect(item.category).toBe("SALES_TAX");
    expect(item.severity).toBe("medium");
    expect(item.title).toContain("Jane Doe");
    expect(item.detail).toContain("2026-11-06");
    expect(item.href).toBe("/desk/customers/cust-exempt-1?tab=billing");
    expect(item.since.toISOString()).toBe("2026-10-07T06:59:59.000Z");
  });

  it("uses Denver calendar days for the exemption warning across spring DST", () => {
    const now = new Date("2026-02-07T18:00:00.000Z");
    expect(taxExemptionExpiryWindow(now).throughExclusive.toISOString()).toBe(
      "2026-03-10T06:00:00.000Z",
    );
    expect(
      taxExemptionWarningSince(new Date("2026-03-10T05:59:59.999Z")).toISOString(),
    ).toBe("2026-02-07T07:00:00.000Z");
  });

  it("uses Denver calendar days for the exemption warning across fall DST", () => {
    const now = new Date("2026-10-05T18:00:00.000Z");
    expect(taxExemptionExpiryWindow(now).throughExclusive.toISOString()).toBe(
      "2026-11-05T07:00:00.000Z",
    );
    expect(
      taxExemptionWarningSince(new Date("2026-11-05T06:59:59.999Z")).toISOString(),
    ).toBe("2026-10-05T06:00:00.000Z");
  });

  it("taxAddressChangedException links to the tax area verification workspace", () => {
    const item = taxAddressChangedException({
      customerId: "cust-tax-change",
      customerName: "Jane Doe",
      addressLabel: "100 Main St, Greeley",
      since: new Date("2026-11-01T13:20:00.000Z"),
    });
    expect(item.category).toBe("SALES_TAX");
    expect(item.severity).toBe("high");
    expect(item.title).toContain("Jane Doe");
    expect(item.href).toBe("/desk/sales-tax/areas?status=REVIEW");
  });

  it("taxRateReviewReminderException stays in the shared Sales tax category", () => {
    const item = taxRateReviewReminderException({
      nextEffectiveDateLabel: "January 1",
      since: new Date("2026-11-15T07:00:00.000Z"),
    });
    expect(item.category).toBe("SALES_TAX");
    expect(item.severity).toBe("medium");
    expect(item.title).toContain("January 1");
    expect(item.href).toBe("/desk/sales-tax/taxability");
  });

  it("staleReservationException links to the draft agreement", () => {
    const item = staleReservationException({
      id: "agr-2",
      reservationExpiresAt: new Date("2026-09-15"),
      customerName: "John Smith",
    });
    expect(item.category).toBe("STALE_RESERVATION");
    expect(item.severity).toBe("medium");
    expect(item.href).toBe("/desk/agreements/agr-2");
  });

  it("pastDueInvoiceException shows the actual amount still owed (due minus paid), not the full invoice total", () => {
    const item = pastDueInvoiceException({
      id: "inv-1",
      customerId: "cust-1",
      customerName: "Jane Doe",
      dueDate: new Date("2026-09-01"),
      amountDueCents: 5000,
      amountPaidCents: 2000,
    });
    expect(item.severity).toBe("high");
    expect(item.detail).toContain("$30.00");
    expect(item.href).toBe("/desk/customers/cust-1");
  });

  it("overdueJobException reads the job type as plain words", () => {
    const item = overdueJobException({
      id: "job-1",
      type: "MAINTENANCE_VISIT",
      scheduledAt: new Date("2026-09-10"),
      customerName: "Jane Doe",
    });
    expect(item.title).toContain("maintenance visit");
    expect(item.href).toBe("/desk/jobs/job-1");
  });

  it("overdueJobException tolerates a job with no linked customer", () => {
    const item = overdueJobException({
      id: "job-2",
      type: "DELIVERY",
      scheduledAt: new Date("2026-09-10"),
      customerName: null,
    });
    expect(item.detail).not.toContain("null");
  });

  it("unreviewedMaintenanceRequestException surfaces the customer's own problem description", () => {
    const item = unreviewedMaintenanceRequestException({
      id: "req-1",
      openedAt: new Date("2026-09-20"),
      customerName: "Jane Doe",
      problem: "Dryer won't heat up.",
    });
    expect(item.detail).toBe("Dryer won't heat up.");
    expect(item.href).toBe("/desk/maintenance/req-1");
  });

  it("uninspectedReturnException links to the appliance's own page", () => {
    const item = uninspectedReturnException({
      id: "appl-1",
      assetNumber: "A-100",
      applianceTypeName: "Washer",
      updatedAt: new Date("2026-09-20"),
    });
    expect(item.title).toContain("Washer (A-100)");
    expect(item.href).toBe("/desk/inventory/appl-1");
  });

  it("missingRepairCostException names the appliance when one is linked to the job", () => {
    const item = missingRepairCostException({
      id: "job-3",
      completedAt: new Date("2026-09-20"),
      applianceLabel: "Washer A-100",
    });
    expect(item.category).toBe("MISSING_REPAIR_COST");
    expect(item.severity).toBe("medium");
    expect(item.title).toContain("Washer A-100");
    expect(item.href).toBe("/desk/jobs/job-3");
  });

  it("missingRepairCostException still reads fine with no appliance linked", () => {
    const item = missingRepairCostException({
      id: "job-4",
      completedAt: new Date("2026-09-20"),
      applianceLabel: null,
    });
    expect(item.title).not.toContain("null");
  });

  // Automation rules (Task #67, docs/DECISIONS.md 2026-09-28).

  it("agreementTermExpiredException names the term length and links to the agreement", () => {
    const item = agreementTermExpiredException({
      id: "agr-3",
      customerName: "Jane Doe",
      termMonths: 12,
      termEndDate: new Date("2026-09-01"),
    });
    expect(item.category).toBe("AGREEMENT_TERM_EXPIRED");
    expect(item.severity).toBe("medium");
    expect(item.title).toContain("Jane Doe's 12-month term has ended");
    expect(item.href).toBe("/desk/agreements/agr-3");
    expect(item.since).toEqual(new Date("2026-09-01"));
  });

  it("applianceMaintenanceDueException names the appliance and links to its inventory page", () => {
    const item = applianceMaintenanceDueException({
      id: "appl-2",
      assetNumber: "A-200",
      applianceTypeName: "Dryer",
      sinceDate: new Date("2026-03-01"),
    });
    expect(item.category).toBe("APPLIANCE_MAINTENANCE_DUE");
    expect(item.severity).toBe("medium");
    expect(item.title).toContain("Dryer (A-200)");
    expect(item.href).toBe("/desk/inventory/appl-2");
    expect(item.since).toEqual(new Date("2026-03-01"));
  });
});

describe("sortExceptions", () => {
  function item(overrides: Partial<ExceptionItem>): ExceptionItem {
    return {
      category: "BILLING_BLOCKED",
      severity: "medium",
      title: "t",
      detail: "d",
      href: "/x",
      since: new Date("2026-09-01"),
      ...overrides,
    };
  }

  it("puts every high-severity item before every medium one, regardless of age", () => {
    const items = [
      item({ severity: "medium", since: new Date("2026-01-01") }),
      item({ severity: "high", since: new Date("2026-09-01") }),
    ];
    const sorted = sortExceptions(items);
    expect(sorted[0].severity).toBe("high");
    expect(sorted[1].severity).toBe("medium");
  });

  it("within the same severity, sorts oldest (earliest 'since') first", () => {
    const items = [
      item({ severity: "high", since: new Date("2026-09-10") }),
      item({ severity: "high", since: new Date("2026-08-01") }),
    ];
    const sorted = sortExceptions(items);
    expect(sorted[0].since.getTime()).toBe(new Date("2026-08-01").getTime());
  });

  it("does not mutate the input array", () => {
    const items = [item({ severity: "medium" }), item({ severity: "high" })];
    const original = [...items];
    sortExceptions(items);
    expect(items).toEqual(original);
  });
});
