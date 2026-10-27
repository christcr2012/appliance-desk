import { describe, expect, it } from "vitest";

import systemChart from "@/domains/books/system-chart.json";
import { SCHEDULE_C_LINE_LABEL, chartScheduleCLine, scheduleCLineFor } from "@/domains/compliance/schedule-c";

/**
 * CMP-2 acceptance: every books account maps to a Schedule C line.
 * The chart is the source: every income, contra-income and expense
 * account in it must carry a real Schedule C line, and the resolver
 * must never drop an account — unmapped ones land on 27a by name.
 */
describe("Schedule C mapping", () => {
  const accounts = systemChart.accounts as Array<{
    role: string;
    name: string;
    type: string;
    scheduleCLine?: string;
  }>;
  const mappable = accounts.filter((a) => ["INCOME", "CONTRA_INCOME", "EXPENSE"].includes(a.type));

  it("maps every income, contra-income and expense account in the system chart", () => {
    expect(mappable.length).toBeGreaterThan(40);
    for (const account of mappable) {
      expect(account.scheduleCLine, `${account.role} (${account.name}) has no Schedule C line`).toBeDefined();
      expect(
        SCHEDULE_C_LINE_LABEL[account.scheduleCLine!],
        `${account.role} maps to unknown line ${account.scheduleCLine}`,
      ).toBeDefined();
    }
  });

  it("puts the headline accounts on the lines the spec names", () => {
    expect(chartScheduleCLine("RENTAL_INCOME")).toBe("1"); // gross receipts
    expect(chartScheduleCLine("EXPENSE_ADVERTISING_AND_MARKETING")).toBe("8");
    expect(chartScheduleCLine("EXPENSE_FUEL")).toBe("9"); // car and truck
    expect(chartScheduleCLine("DEPRECIATION")).toBe("13");
    expect(chartScheduleCLine("EXPENSE_BUSINESS_INSURANCE")).toBe("15");
    expect(chartScheduleCLine("REPAIRS_PARTS")).toBe("21");
    expect(chartScheduleCLine("EXPENSE_SUPPLIES")).toBe("22");
    expect(chartScheduleCLine("EXPENSE_LICENSES_AND_PERMITS")).toBe("23");
    expect(chartScheduleCLine("EXPENSE_PHONE_AND_INTERNET")).toBe("25");
    expect(chartScheduleCLine("EXPENSE_STORAGE___WAREHOUSE_RENT")).toBe("20b"); // rent of business property
    expect(chartScheduleCLine("REFUNDS")).toBe("2"); // returns and allowances
  });

  it("resolves stored line first, then the chart, then 27a — never nothing", () => {
    expect(scheduleCLineFor({ scheduleCLine: "8", systemRole: "RENTAL_INCOME" })).toBe("8");
    expect(scheduleCLineFor({ scheduleCLine: null, systemRole: "RENTAL_INCOME" })).toBe("1");
    expect(scheduleCLineFor({ scheduleCLine: null, systemRole: null })).toBe("27a");
    expect(scheduleCLineFor({ scheduleCLine: null, systemRole: "SOME_FUTURE_ROLE" })).toBe("27a");
    // Balance-sheet accounts are not part of Schedule C at all.
    expect(chartScheduleCLine("BANK")).toBeUndefined();
  });
});
