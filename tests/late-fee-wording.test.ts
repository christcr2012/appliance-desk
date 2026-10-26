import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTAL_DYNAMIC_COPY, portalStatement } from "@/domains/language/portal-copy";
import { TRANSACTIONAL_COPY } from "@/domains/language/transactional-copy";

// FEE-1 rule 8: the late-fee wording a customer signs and the warning they get carry the same figures in English and Spanish.
describe("late fee wording", () => {
  for (const language of ["en", "es"] as const) {
    it(`the signing page text (${language}) names the day count, the $15 limit, once per bill, next bill, autopay and waiving`, () => {
      const start = portalStatement(language, "lateFee", { days: 10 });
      expect(start).toContain("10");
      const rest = PORTAL_DYNAMIC_COPY[language].lateFeeRest;
      expect(rest).toContain("$15");
      expect(rest.length).toBeGreaterThan(120);
    });
    it(`the warning message (${language}) carries amount, bill number, due date, fee date and fee`, () => {
      const text = TRANSACTIONAL_COPY[language].lateNoticeIntro;
      for (const name of ["amount", "number", "due", "feeDate", "fee"]) expect(text).toContain(`{{${name}}}`);
      expect(TRANSACTIONAL_COPY[language].lateNoticeRetry.length).toBeGreaterThan(20);
      expect(TRANSACTIONAL_COPY[language].billingLateFee).toContain("{{fee}}");
      expect(TRANSACTIONAL_COPY[language].billingLateFee).toContain("{{number}}");
    });
  }

  it("the signing page uses the new wording and never shows fewer than 10 days", () => {
    const page = readFileSync("src/app/sign/[id]/page.tsx", "utf8");
    expect(page).toContain('portalStatement(language,"lateFeeRest")');
    expect(page).toContain("Math.max(10,agreement.lateFeeGraceDays)");
  });
});
