import type {
  TaxAdministration,
  TaxJurisdictionLevel,
} from "@prisma/client";

export type GisJurisdiction = {
  code: string;
  name: string;
  level: TaxJurisdictionLevel;
  administration: TaxAdministration | null;
  rateMilliPercent: number | null;
};

export type GisLookup =
  | {
      status: "MATCHED";
      normalizedAddress: string;
      jurisdictions: GisJurisdiction[];
    }
  | {
      status: "AMBIGUOUS" | "NOT_FOUND" | "UNAVAILABLE";
      message: string;
    };

export interface ColoradoRateSource {
  lookup(address: {
    line1: string;
    line2?: string | null;
    city: string;
    zip: string;
  }): Promise<GisLookup>;
}

/**
 * WU-T0's authenticated SUTS API contract is not available in the repository
 * yet, so T-2 deliberately ships the approved manual fallback instead of
 * guessing an endpoint, auth header, or response shape.
 */
class ManualOnlySource implements ColoradoRateSource {
  readonly kind = "MANUAL" as const;

  async lookup(): Promise<GisLookup> {
    return {
      status: "UNAVAILABLE",
      message:
        "Automatic Colorado tax lookup is not configured yet. Review this address manually.",
    };
  }
}

const manualOnlySource = new ManualOnlySource();
let sourceForTests: ColoradoRateSource | null = null;

export function getColoradoRateSource(): ColoradoRateSource {
  return sourceForTests ?? manualOnlySource;
}

/**
 * Scheduled re-checks must never treat the manual fallback as an automatic
 * provider. Production remains false until the authenticated SUTS contract is
 * implemented; injected test sources are automatic by definition.
 */
export function hasAutomaticColoradoRateSource(): boolean {
  return getColoradoRateSource() !== manualOnlySource;
}

/** Test seam only. Production callers always receive the configured source. */
export function __setColoradoRateSourceForTests(
  source: ColoradoRateSource | null,
): void {
  sourceForTests = source;
}
