import { describe, expect, it } from "vitest";
import {
  DEPOSIT_BUCKET_LABEL,
  depositAgeBucket,
  summarizeDepositLiability,
  type DepositLiabilityRow,
} from "@/domains/billing/deposit-liability";

const now = new Date("2026-10-05T18:00:00Z"); // Oct 5, Colorado

describe("deposit age groups", () => {
  it("a rental still in progress has no age", () => {
    expect(depositAgeBucket(null, now)).toEqual({ bucket: "STILL_RENTING", daysSinceEnd: null });
  });
  it("counts whole Colorado days since the rental ended", () => {
    expect(depositAgeBucket(new Date("2026-10-05T14:00:00Z"), now)).toEqual({ bucket: "DAYS_0_30", daysSinceEnd: 0 });
    // 30 days before Oct 5 is Sep 5: still in the first group; Sep 4 is 31 days.
    expect(depositAgeBucket(new Date("2026-09-05T18:00:00Z"), now).bucket).toBe("DAYS_0_30");
    expect(depositAgeBucket(new Date("2026-09-04T18:00:00Z"), now)).toEqual({ bucket: "DAYS_31_90", daysSinceEnd: 31 });
    // 90 days before Oct 5 is Jul 7; Jul 6 is 91 days.
    expect(depositAgeBucket(new Date("2026-07-07T18:00:00Z"), now).bucket).toBe("DAYS_31_90");
    expect(depositAgeBucket(new Date("2026-07-06T18:00:00Z"), now)).toEqual({ bucket: "OVER_90", daysSinceEnd: 91 });
  });
  it("uses the Colorado date, not UTC, for a late-evening ending", () => {
    // 2026-09-05 03:00 UTC is still Sep 4 in Colorado: 31 days before Oct 5.
    expect(depositAgeBucket(new Date("2026-09-05T03:00:00Z"), now)).toEqual({ bucket: "DAYS_31_90", daysSinceEnd: 31 });
  });
  it("an ending in the future is not negative", () => {
    expect(depositAgeBucket(new Date("2026-10-09T18:00:00Z"), now).daysSinceEnd).toBe(0);
  });
});

describe("deposit totals", () => {
  const row = (amountCents: number, bucket: DepositLiabilityRow["bucket"]): DepositLiabilityRow => ({
    depositId: `d${amountCents}`,
    agreementId: "a",
    customerId: "c",
    customerName: "N",
    amountCents,
    bucket,
    daysSinceEnd: null,
    overdue: bucket === "OVER_90",
  });
  it("adds each group and the total in whole cents", () => {
    const s = summarizeDepositLiability([row(5000, "OVER_90"), row(2500, "OVER_90"), row(10000, "DAYS_0_30"), row(7500, "STILL_RENTING")]);
    expect(s.totalCents).toBe(25000);
    expect(s.count).toBe(4);
    expect(s.byBucket.OVER_90).toEqual({ cents: 7500, count: 2 });
    expect(s.byBucket.DAYS_31_90).toEqual({ cents: 0, count: 0 });
    expect(Object.keys(s.byBucket).sort()).toEqual(Object.keys(DEPOSIT_BUCKET_LABEL).sort());
  });
});
