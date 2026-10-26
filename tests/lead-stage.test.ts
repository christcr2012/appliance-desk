import { describe, expect, it } from "vitest";
import { leadStage, type LeadStage } from "@/domains/leads/stage";

/** LD-1: the derived pipeline stage. First match wins; a website lead is
 * "new" until a real person contacts them — creation alone never counts. */
describe("leadStage", () => {
  const cases: {
    name: string;
    input: { status: "NEW" | "CONTACTED" | "CONVERTED" | "LOST"; firstContactedAt: Date | null; openQuote: boolean };
    want: LeadStage;
  }[] = [
    { name: "a fresh website lead is new", input: { status: "NEW", firstContactedAt: null, openQuote: false }, want: "new" },
    { name: "a contacted lead is contacted", input: { status: "CONTACTED", firstContactedAt: new Date(), openQuote: false }, want: "contacted" },
    { name: "a NEW lead already contacted once is contacted, not new", input: { status: "NEW", firstContactedAt: new Date(), openQuote: false }, want: "contacted" },
    { name: "a NEW lead with a sent quote is quoted", input: { status: "NEW", firstContactedAt: null, openQuote: true }, want: "quoted" },
    { name: "a contacted lead with a viewed quote is quoted", input: { status: "CONTACTED", firstContactedAt: new Date(), openQuote: true }, want: "quoted" },
    { name: "a converted lead is won even with an open quote", input: { status: "CONVERTED", firstContactedAt: new Date(), openQuote: true }, want: "won" },
    { name: "a lost lead is lost even with an open quote", input: { status: "LOST", firstContactedAt: new Date(), openQuote: true }, want: "lost" },
    { name: "a converted lead with no quote is won", input: { status: "CONVERTED", firstContactedAt: null, openQuote: false }, want: "won" },
  ];
  for (const { name, input, want } of cases) {
    it(name, () => {
      expect(leadStage(input)).toBe(want);
    });
  }
});
