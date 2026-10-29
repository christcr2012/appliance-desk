import { describe, expect, it } from "vitest";
import { leadNextStep, type LeadNextStepInput } from "@/domains/leads/next-step";
import { businessDateFromKey } from "@/lib/business-date";

const noonDenver = (key: string) => new Date(`${key}T18:00:00Z`); // noon MDT

function row(over: Partial<LeadNextStepInput>): LeadNextStepInput {
  return {
    stage: "contacted",
    createdAt: new Date("2026-10-20T14:00:00Z"),
    nextFollowUpOn: null,
    openQuote: null,
    responseDays: 1,
    ...over,
  };
}

describe("leadNextStep", () => {
  it("new lead waiting under the target: Call with a relative age, info tone", () => {
    const got = leadNextStep(
      row({ stage: "new", createdAt: new Date("2026-10-29T14:00:00Z") }),
      new Date("2026-10-29T16:00:00Z"),
    );
    expect(got).toEqual({ text: "Call — waiting 2 h", tone: "info" });
  });

  it("new lead past the response-days target across a weekend: attention tone", () => {
    // Created Friday, target one day later (Saturday); it is now Monday.
    const got = leadNextStep(
      row({ stage: "new", createdAt: new Date("2026-10-23T15:00:00Z") }),
      new Date("2026-10-26T15:00:00Z"),
    );
    expect(got).toEqual({ text: "Call — waiting 3 days", tone: "attention" });
  });

  it("new lead under an hour old: minutes", () => {
    const got = leadNextStep(
      row({ stage: "new", createdAt: new Date("2026-10-29T15:30:00Z") }),
      new Date("2026-10-29T16:00:00Z"),
    );
    expect(got.text).toBe("Call — waiting 30 min");
  });

  it("follow-up overdue by one day, and by several days", () => {
    const now = noonDenver("2026-10-29");
    expect(
      leadNextStep(row({ nextFollowUpOn: businessDateFromKey("2026-10-28") }), now),
    ).toEqual({ text: "Follow up — 1 day overdue", tone: "attention" });
    expect(
      leadNextStep(row({ nextFollowUpOn: businessDateFromKey("2026-10-26") }), now),
    ).toEqual({ text: "Follow up — 3 days overdue", tone: "attention" });
  });

  it("follow-up today", () => {
    const now = noonDenver("2026-10-29");
    expect(leadNextStep(row({ nextFollowUpOn: businessDateFromKey("2026-10-29") }), now)).toEqual({
      text: "Follow up today",
      tone: "info",
    });
  });

  it("quoted and viewed: viewed wording, info tone", () => {
    const now = noonDenver("2026-10-29");
    expect(
      leadNextStep(
        row({
          stage: "quoted",
          openQuote: { status: "VIEWED", sentAt: new Date("2026-10-27T14:00:00Z"), viewedAt: new Date("2026-10-28T14:00:00Z") },
        }),
        now,
      ),
    ).toEqual({ text: "Quote viewed yesterday — follow up", tone: "info" });
  });

  it("quoted and not viewed: sent wording, neutral tone", () => {
    const now = noonDenver("2026-10-29");
    expect(
      leadNextStep(
        row({ stage: "quoted", openQuote: { status: "SENT", sentAt: new Date("2026-10-27T14:00:00Z"), viewedAt: null } }),
        now,
      ),
    ).toEqual({ text: "Quote sent 2 days ago", tone: "neutral" });
  });

  it("an overdue follow-up beats the quote wording", () => {
    const now = noonDenver("2026-10-29");
    expect(
      leadNextStep(
        row({
          stage: "quoted",
          nextFollowUpOn: businessDateFromKey("2026-10-28"),
          openQuote: { status: "SENT", sentAt: new Date("2026-10-27T14:00:00Z"), viewedAt: null },
        }),
        now,
      ),
    ).toEqual({ text: "Follow up — 1 day overdue", tone: "attention" });
  });

  it("follow-up later: formatted date, neutral tone", () => {
    const now = noonDenver("2026-10-29");
    expect(leadNextStep(row({ nextFollowUpOn: businessDateFromKey("2026-10-30") }), now)).toEqual({
      text: "Follow up Oct 30",
      tone: "neutral",
    });
  });

  it("won: Became a customer, good tone", () => {
    expect(leadNextStep(row({ stage: "won" }), noonDenver("2026-10-29"))).toEqual({
      text: "Became a customer",
      tone: "good",
    });
  });

  it("lost: the reason, cut to 60 chars, neutral tone", () => {
    const reason = "Never heard back after contacting them many times over many weeks and months";
    expect(leadNextStep(row({ stage: "lost", lostReason: reason }), noonDenver("2026-10-29"))).toEqual({
      text: reason.slice(0, 60),
      tone: "neutral",
    });
  });

  it("otherwise: Set a follow-up date", () => {
    expect(leadNextStep(row({}), noonDenver("2026-10-29"))).toEqual({
      text: "Set a follow-up date",
      tone: "neutral",
    });
  });
});
