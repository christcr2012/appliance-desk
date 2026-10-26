import { describe, expect, it } from "vitest";
import {
  RECOMMENDED_LADDER, daysPastDue, filingCounts, filingRoom, pickupGate, smallClaimsEligible, smallClaimsFee,
  stepsCameUp, validateLadder,
} from "@/domains/collections/rules";
import {
  COLLECTION_BUSINESS_NAME, renderFinalNotice, renderFinalNoticeLetterPdf, renderSecondNotice, type NoticeFacts,
} from "@/domains/collections/templates";
import { denverYearMonth, renderSmallClaimsPacket, type SmallClaimsFacts } from "@/domains/collections/packet";

const facts: NoticeFacts = { customerName: "Ana López", invoiceNumber: 42, owedCents: 12_500, dueOnText: "October 3, 2026", daysPastDue: 21 };

describe("past-due ladder rules", () => {
  it("starts at 10 / 20 / 30 days and demands whole numbers in order", () => {
    expect(RECOMMENDED_LADDER).toEqual({ secondNotice: 10, finalNotice: 20, decision: 30 });
    expect(validateLadder(RECOMMENDED_LADDER)).toBeNull();
    expect(validateLadder({ secondNotice: 20, finalNotice: 10, decision: 30 })).toMatch(/before/);
    expect(validateLadder({ secondNotice: 1, finalNotice: 20, decision: 30 })).toMatch(/whole numbers/);
    expect(validateLadder({ secondNotice: 5.5, finalNotice: 20, decision: 30 })).toMatch(/whole numbers/);
  });

  it("counts days past due on Denver dates and never skips a step after a missed night", () => {
    expect(daysPastDue("2026-10-03", "2026-10-13")).toBe(10);
    expect(daysPastDue("2026-02-27", "2026-03-02")).toBe(3);
    expect(daysPastDue("2026-10-13", "2026-10-03")).toBe(-10);
    expect(stepsCameUp(9, RECOMMENDED_LADDER)).toEqual([]);
    expect(stepsCameUp(10, RECOMMENDED_LADDER)).toEqual(["SECOND_NOTICE"]);
    expect(stepsCameUp(45, RECOMMENDED_LADDER)).toEqual(["SECOND_NOTICE", "FINAL_NOTICE", "DECISION"]);
  });
});

describe("pickup after default", () => {
  const consent = new Date("2026-11-01T00:00:00Z");
  it("needs the customer's recorded agreement, or a court order", () => {
    expect(pickupGate({ consentAt: null, activeDuty: false, courtOrderOn: null })).toMatchObject({ ok: false, reason: "NO_CONSENT" });
    expect(pickupGate({ consentAt: consent, activeDuty: false, courtOrderOn: null })).toEqual({ ok: true });
    expect(pickupGate({ consentAt: null, activeDuty: false, courtOrderOn: consent })).toEqual({ ok: true });
  });
  it("never allows a pickup from an active-duty customer without a court order, even with their consent", () => {
    expect(pickupGate({ consentAt: consent, activeDuty: true, courtOrderOn: null })).toMatchObject({ ok: false, reason: "COURT_ORDER_REQUIRED" });
    expect(pickupGate({ consentAt: consent, activeDuty: true, courtOrderOn: consent })).toEqual({ ok: true });
  });
});

describe("small-claims limits", () => {
  it("is eligible up to the limit only", () => {
    expect(smallClaimsEligible(750_000, 750_000).ok).toBe(true);
    expect(smallClaimsEligible(750_001, 750_000).ok).toBe(false);
    expect(smallClaimsEligible(0, 750_000).ok).toBe(false);
  });
  it("picks the filing fee by the amount claimed", () => {
    const fees = { lowMaxCents: 50_000, lowFeeCents: 3_100, highFeeCents: 5_500 };
    expect(smallClaimsFee(50_000, fees)).toBe(3_100);
    expect(smallClaimsFee(50_001, fees)).toBe(5_500);
  });
  it("counts filings per county, per Denver month and year, and blocks the third in a month", () => {
    const now = new Date("2026-11-15T18:00:00Z");
    const filings = [
      { county: "Weld", filedOn: new Date("2026-11-02T18:00:00Z") },
      { county: "weld ", filedOn: new Date("2026-11-10T18:00:00Z") },
      { county: "Larimer", filedOn: new Date("2026-11-11T18:00:00Z") },
      { county: "Weld", filedOn: new Date("2026-03-01T18:00:00Z") },
      { county: "Weld", filedOn: new Date("2025-11-20T18:00:00Z") },
    ];
    const counts = filingCounts(filings, "Weld", now, denverYearMonth);
    expect(counts).toEqual({ thisMonth: 2, thisYear: 3 });
    expect(filingRoom(counts, { perMonth: 2, perYear: 18 }).ok).toBe(false);
    expect(filingRoom({ thisMonth: 1, thisYear: 3 }, { perMonth: 2, perYear: 18 }).ok).toBe(true);
    expect(filingRoom({ thisMonth: 0, thisYear: 18 }, { perMonth: 2, perYear: 18 }).ok).toBe(false);
  });
});

describe("collection wording", () => {
  const all = [renderSecondNotice(facts), renderFinalNotice(facts), renderFinalNotice({ ...facts, finalDeadlineText: "November 20, 2026" })];
  it("is always written in the business's own name", () => {
    for (const message of all) {
      expect(message.body).toContain(COLLECTION_BUSINESS_NAME);
      expect(message.subject).toContain(COLLECTION_BUSINESS_NAME);
    }
  });
  it("never uses a collection agency's name, on-behalf-of wording, or threats (C.R.S. 5-16-103)", () => {
    for (const message of all) {
      expect(`${message.subject}\n${message.body}`).not.toMatch(/collection agency|debt collector|on behalf of|third part|arrest|jail|garnish|credit report|credit bureau|lawsuit will be filed|ruin/i);
    }
  });
  it("states the amount and the due date, and offers a payment plan in the final notice", () => {
    expect(all[1]!.body).toContain("$125.00");
    expect(all[1]!.body).toContain("October 3, 2026");
    expect(all[1]!.body).toMatch(/payment plan/i);
  });
  it("makes a one-page PDF letter", async () => {
    const pdf = await renderFinalNoticeLetterPdf({ ...facts, todayText: "October 26, 2026", addressLines: ["Ana López", "1 Test St", "Greeley, CO 80631"] });
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("small-claims packet", () => {
  const base: SmallClaimsFacts = {
    agreementId: "a1", customerName: "Ana López", owedCents: 25_000,
    ledger: [{ invoiceNumber: 7, dueOn: new Date("2026-09-03T06:00:00Z"), amountDueCents: 25_000, amountPaidCents: 0, payments: [] }],
    notices: [{ kind: "FINAL_NOTICE", sentAt: new Date("2026-09-25T06:00:00Z") }],
    appliances: [{ label: "A-1 Maytag MVWC", costCents: 40_000 }],
    agreementSignedAt: new Date("2026-06-01T06:00:00Z"), agreementStart: new Date("2026-06-05T06:00:00Z"),
    defendantAddress: ["1 Test St", "Greeley, CO 80631"],
    eligible: { ok: true, reason: null }, feeCents: 3_100, limitCents: 750_000, county: "Weld", filingNote: "0 of 2 used this month",
  };
  it("builds a PDF and says plainly when the claim is not ready", async () => {
    const ok = await renderSmallClaimsPacket(base);
    expect(Buffer.from(ok).subarray(0, 5).toString()).toBe("%PDF-");
    const notReady = await renderSmallClaimsPacket({ ...base, eligible: { ok: false, reason: "The amount owed is over the small-claims limit." } });
    expect(notReady.byteLength).toBeGreaterThan(500);
  });
});
