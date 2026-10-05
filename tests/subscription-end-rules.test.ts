import { describe, expect, it } from "vitest";

import {
  decideSubscriptionEnd,
  type SubscriptionEndFacts,
} from "@/domains/billing/subscription-end";
import { cancelAtSecondsFor } from "@/domains/billing/subscription-term";

const holderEnd = new Date("2027-10-31T05:59:59.000Z");
const renewalEnd = new Date("2028-10-31T05:59:59.000Z");
const renewalStart = new Date("2027-11-01T06:00:00.000Z");
const earlyEffective = new Date("2027-08-01T06:00:00.000Z");

function facts(overrides: Partial<SubscriptionEndFacts> = {}): SubscriptionEndFacts {
  return {
    stripeSubscriptionId: "sub_rules",
    holder: {
      id: "agreement-old",
      status: "ACTIVE",
      termMonths: 12,
      endDate: holderEnd,
      terminationEffectiveOn: null,
      terminationRequestedAt: null,
      renewalPreference: "AUTO_RENEW",
      autoRenewConsentedAt: new Date("2026-10-01T06:00:00.000Z"),
    },
    scheduledRenewal: null,
    autoRenewEnabled: true,
    reminderCheck: null,
    ...overrides,
  };
}

function fixedEnd(date: Date) {
  return new Date(cancelAtSecondsFor({ termMonths: 12, endDate: date })! * 1000);
}

describe("Batch B2 subscription-end rules", () => {
  it("no holder is closed", () => {
    expect(decideSubscriptionEnd(facts({ holder: null }))).toMatchObject({
      mode: "CLOSED",
      reason: "NO_HOLDER",
    });
  });

  it("closed holder is closed", () => {
    const f = facts();
    f.holder = { ...f.holder!, status: "ENDED" };
    expect(decideSubscriptionEnd(f)).toMatchObject({ mode: "CLOSED", reason: "HOLDER_CLOSED" });
  });

  it("fixed term ends at its natural term end", () => {
    const result = decideSubscriptionEnd(facts());
    expect(result).toMatchObject({ mode: "END_AT", reason: "TERM_END" });
    expect(result.cancelAt?.getTime()).toBe(fixedEnd(holderEnd).getTime());
  });

  it("fixed term with an earlier requested ending uses the earlier ending", () => {
    const f = facts();
    f.holder = {
      ...f.holder!,
      terminationRequestedAt: new Date("2027-07-01T06:00:00.000Z"),
      terminationEffectiveOn: earlyEffective,
    };
    const result = decideSubscriptionEnd(f);
    expect(result).toMatchObject({ mode: "END_AT", reason: "EARLY_ENDING" });
    expect(result.cancelAt?.toISOString()).toBe("2027-08-01T05:59:59.000Z");
  });

  it("month-to-month has no end", () => {
    const f = facts();
    f.holder = { ...f.holder!, termMonths: null, endDate: null };
    expect(decideSubscriptionEnd(f)).toMatchObject({
      mode: "NO_END",
      reason: "MONTH_TO_MONTH",
      cancelAt: null,
    });
  });

  it("month-to-month requested ending stops before its effective anniversary", () => {
    const f = facts();
    f.holder = {
      ...f.holder!,
      termMonths: null,
      endDate: null,
      terminationRequestedAt: new Date("2027-07-01T06:00:00.000Z"),
      terminationEffectiveOn: earlyEffective,
    };
    const result = decideSubscriptionEnd(f);
    expect(result).toMatchObject({ mode: "END_AT", reason: "MONTH_TO_MONTH_ENDING" });
    expect(result.cancelAt?.toISOString()).toBe("2027-08-01T05:59:59.000Z");
  });

  it("hand fixed renewal extends to its fixed end", () => {
    const f = facts({
      scheduledRenewal: {
        id: "renewal",
        termMonths: 12,
        endDate: renewalEnd,
        startDate: renewalStart,
        createdByAutoRenew: false,
      },
    });
    const result = decideSubscriptionEnd(f);
    expect(result).toMatchObject({ mode: "END_AT", reason: "RENEWAL_EXTENDS_FIXED" });
    expect(result.cancelAt?.getTime()).toBe(fixedEnd(renewalEnd).getTime());
  });

  it("hand monthly renewal clears the end", () => {
    const result = decideSubscriptionEnd(
      facts({
        scheduledRenewal: {
          id: "renewal",
          termMonths: null,
          endDate: null,
          startDate: renewalStart,
          createdByAutoRenew: false,
        },
      }),
    );
    expect(result).toMatchObject({ mode: "NO_END", reason: "RENEWAL_EXTENDS_MONTHLY" });
  });

  it("automatic renewal with switch off keeps the holder's own end", () => {
    const result = decideSubscriptionEnd(
      facts({
        autoRenewEnabled: false,
        reminderCheck: "OK",
        scheduledRenewal: {
          id: "renewal",
          termMonths: 12,
          endDate: renewalEnd,
          startDate: renewalStart,
          createdByAutoRenew: true,
        },
      }),
    );
    expect(result).toMatchObject({ mode: "END_AT", reason: "TERM_END" });
    expect(result.cancelAt?.getTime()).toBe(fixedEnd(holderEnd).getTime());
  });

  it("automatic renewal with consent withdrawn keeps the holder's own end", () => {
    const f = facts({
      reminderCheck: "OK",
      scheduledRenewal: {
        id: "renewal",
        termMonths: 12,
        endDate: renewalEnd,
        startDate: renewalStart,
        createdByAutoRenew: true,
      },
    });
    f.holder = { ...f.holder!, renewalPreference: "NONE", autoRenewConsentedAt: null };
    expect(decideSubscriptionEnd(f)).toMatchObject({ mode: "END_AT", reason: "TERM_END" });
  });

  it("automatic renewal without a delivered reminder keeps the old end", () => {
    const result = decideSubscriptionEnd(
      facts({
        reminderCheck: "NOT_DELIVERED",
        scheduledRenewal: {
          id: "renewal",
          termMonths: 12,
          endDate: renewalEnd,
          startDate: renewalStart,
          createdByAutoRenew: true,
        },
      }),
    );
    expect(result).toMatchObject({ mode: "END_AT", reason: "TERM_END" });
  });

  it("automatic renewal whose reminder was delivered out of window keeps the old end", () => {
    const result = decideSubscriptionEnd(
      facts({
        reminderCheck: "OUT_OF_WINDOW",
        scheduledRenewal: {
          id: "renewal",
          termMonths: 12,
          endDate: renewalEnd,
          startDate: renewalStart,
          createdByAutoRenew: true,
        },
      }),
    );
    expect(result).toMatchObject({ mode: "END_AT", reason: "TERM_END" });
  });

  it("an ending request beats a waiting automatic renewal", () => {
    const f = facts({
      reminderCheck: "OK",
      scheduledRenewal: {
        id: "renewal",
        termMonths: 12,
        endDate: renewalEnd,
        startDate: renewalStart,
        createdByAutoRenew: true,
      },
    });
    f.holder = {
      ...f.holder!,
      terminationRequestedAt: new Date("2027-07-01T06:00:00.000Z"),
      terminationEffectiveOn: earlyEffective,
    };
    const result = decideSubscriptionEnd(f);
    expect(result).toMatchObject({ mode: "END_AT", reason: "EARLY_ENDING" });
    expect(result.cancelAt?.toISOString()).toBe("2027-08-01T05:59:59.000Z");
  });
});
