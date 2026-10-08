import { afterEach, describe, expect, it } from "vitest";

import {
  __setColoradoRateSourceForTests,
  type ColoradoRateSource,
} from "@/domains/tax/colorado-gis";
import {
  effectiveObservationLookAheadThrough,
  runOfficialRateObservation,
} from "@/domains/tax/official-rate-auto-apply";
import { businessDateKey } from "@/lib/business-date";

afterEach(() => {
  __setColoradoRateSourceForTests(null);
});

describe("T-5b3 official effective-rate provider seam", () => {
  it("unsupported effective-date lookup is a no-op", async () => {
    __setColoradoRateSourceForTests({
      async lookup() {
        return { status: "UNAVAILABLE", message: "not used" };
      },
      async lookupEffectiveRates() {
        return { status: "UNSUPPORTED" };
      },
    });

    await expect(
      runOfficialRateObservation(new Date("2026-10-08T18:00:00.000Z")),
    ).resolves.toEqual({
      status: "UNSUPPORTED",
      observations: 0,
      autoApplied: 0,
      reviewRequired: 0,
      ignored: 0,
    });
  });

  it("unavailable effective-date lookup preserves evidence by making no writes", async () => {
    let calls = 0;
    const source: ColoradoRateSource = {
      async lookup() {
        return { status: "UNAVAILABLE", message: "not used" };
      },
      async lookupEffectiveRates() {
        calls += 1;
        return { status: "UNAVAILABLE", reason: "synthetic outage" };
      },
    };
    __setColoradoRateSourceForTests(source);

    await expect(
      runOfficialRateObservation(new Date("2026-10-08T18:00:00.000Z")),
    ).resolves.toMatchObject({
      status: "UNAVAILABLE",
      observations: 0,
      autoApplied: 0,
      reviewRequired: 0,
      ignored: 0,
    });
    expect(calls).toBe(1);
  });

  it("only June and December extend the effective-rate look-ahead", () => {
    expect(
      businessDateKey(
        effectiveObservationLookAheadThrough(
          new Date("2026-06-10T18:00:00.000Z"),
        ),
      ),
    ).toBe("2026-07-01");
    expect(
      businessDateKey(
        effectiveObservationLookAheadThrough(
          new Date("2026-12-10T18:00:00.000Z"),
        ),
      ),
    ).toBe("2027-01-01");
    expect(
      businessDateKey(
        effectiveObservationLookAheadThrough(
          new Date("2026-10-08T18:00:00.000Z"),
        ),
      ),
    ).toBe("2026-10-08");
  });
});
