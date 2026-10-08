import { describe, expect, it } from "vitest";

import {
  officialRateReviewException,
  officialRateScheduledException,
} from "@/domains/exceptions/rules";
import { isOfficialRateUndoAllowed } from "@/domains/tax/official-rate-auto-apply";
import { businessDateFromKey } from "@/lib/business-date";

describe("T-5b3 official-rate Today items", () => {
  it("successful auto change is informational with owner undo only inside the allowed window", () => {
    const effectiveFrom = businessDateFromKey("2027-01-01")!;
    expect(
      isOfficialRateUndoAllowed(
        effectiveFrom,
        new Date("2026-12-29T18:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isOfficialRateUndoAllowed(
        effectiveFrom,
        new Date("2026-12-31T18:00:00.000Z"),
      ),
    ).toBe(false);

    const actionable = officialRateScheduledException({
      rateVersionId: "rate-1",
      jurisdictionName: "Weld County",
      oldRateMilliPercent: 1_000,
      newRateMilliPercent: 1_200,
      effectiveFrom,
      since: new Date("2026-12-20T18:00:00.000Z"),
      undoAllowed: true,
    });
    expect(actionable).toMatchObject({
      category: "SALES_TAX",
      severity: "medium",
      title: "Official tax rate scheduled",
      action: {
        type: "UNDO_OFFICIAL_RATE",
        id: "rate-1",
        label: "Undo",
      },
    });
    expect(actionable.detail).toContain("1.000% → 1.200%");
    expect(actionable.detail).toContain("2027-01-01");

    const locked = officialRateScheduledException({
      rateVersionId: "rate-1",
      jurisdictionName: "Weld County",
      oldRateMilliPercent: 1_000,
      newRateMilliPercent: 1_200,
      effectiveFrom,
      since: new Date("2026-12-20T18:00:00.000Z"),
      undoAllowed: false,
    });
    expect(locked.action).toBeUndefined();
  });

  it("failed guardrail is high priority with owner apply action", () => {
    const item = officialRateReviewException({
      observationId: "obs-1",
      jurisdictionName: "Greeley",
      oldRateMilliPercent: 4_110,
      newRateMilliPercent: 5_500,
      effectiveFrom: businessDateFromKey("2027-01-01")!,
      reasons: ["AUTO_APPLY_DISABLED", "DELTA_EXCEEDS_LIMIT"],
      since: new Date("2026-12-20T18:00:00.000Z"),
    });

    expect(item).toMatchObject({
      category: "SALES_TAX",
      severity: "high",
      title: "Official rate needs review",
      action: {
        type: "APPLY_OFFICIAL_RATE",
        id: "obs-1",
        label: "Apply this rate",
      },
    });
    expect(item.detail).toContain("automatic official-rate changes are turned off");
    expect(item.detail).toContain("rate jump exceeds");
  });
});
