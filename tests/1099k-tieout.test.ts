import { describe, expect, it } from "vitest";

import { bucketOf, summarizeKTransactions, type KTransactionRow } from "@/domains/compliance/k-reconciliation";

/**
 * CMP-2: the 1099-K tie-out math over stored Stripe balance rows.
 * Charges are the gross the 1099-K reports; fees, refunds and disputes
 * explain the road from gross charges to the net that reached the bank.
 */
const row = (iso: string, reportingCategory: string, amountCents: number, feeCents = 0): KTransactionRow => ({
  createdAtStripe: new Date(iso),
  reportingCategory,
  amountCents,
  feeCents,
  netCents: amountCents - feeCents,
});

describe("1099-K tie-out", () => {
  it("buckets Stripe reporting categories", () => {
    expect(bucketOf("charge")).toBe("charges");
    expect(bucketOf("refund")).toBe("refunds");
    expect(bucketOf("dispute")).toBe("disputes");
    expect(bucketOf("dispute_reversal")).toBe("disputes");
    expect(bucketOf("fee")).toBe("other");
    expect(bucketOf("payout")).toBe("other");
  });

  it("summarizes by month for the year only", () => {
    const summary = summarizeKTransactions(
      [
        row("2026-01-15T10:00:00Z", "charge", 100_000, 3_000),
        row("2026-01-20T10:00:00Z", "refund", -10_000),
        row("2026-02-02T10:00:00Z", "charge", 50_000, 1_500),
        row("2026-02-03T10:00:00Z", "dispute", -5_000),
        row("2025-12-31T10:00:00Z", "charge", 999_999), // last year: excluded
      ],
      2026,
    );
    expect(summary.months.map((m) => m.month)).toEqual(["2026-01", "2026-02"]);
    expect(summary.chargesCents).toBe(150_000);
    expect(summary.feesCents).toBe(4_500);
    expect(summary.refundsCents).toBe(-10_000);
    expect(summary.disputesCents).toBe(-5_000);
    expect(summary.netCents).toBe(100_000 - 3_000 - 10_000 + 50_000 - 1_500 - 5_000);
    expect(summary.months[0]).toMatchObject({ month: "2026-01", chargesCents: 100_000, refundsCents: -10_000 });
  });

  it("an empty year ties out at zero", () => {
    const summary = summarizeKTransactions([], 2026);
    expect(summary.months).toEqual([]);
    expect(summary.chargesCents).toBe(0);
  });
});
