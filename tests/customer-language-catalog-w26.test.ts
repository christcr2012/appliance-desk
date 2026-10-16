import { describe, expect, it } from "vitest";
import { customerStrings } from "@/domains/language/copy";
import { FORM_COPY } from "@/domains/language/estimate-form-copy";
import { ESTIMATE_COPY } from "@/domains/language/estimate-copy";
import { SIGNING_COPY } from "@/domains/language/signing-copy";
import { PORTAL_TRANSLATIONS } from "@/domains/language/portal-copy";
import { REVIEWED_MONEY_LABELS } from "@/domains/language/reviewed-money";

const catalogs = {
  main: customerStrings,
  estimate: ESTIMATE_COPY,
  estimateResponse: FORM_COPY,
  signing: SIGNING_COPY,
  reviewedMoney: REVIEWED_MONEY_LABELS,
};

describe("W-26 bilingual keyset and translation draft contract", () => {
  it.each(Object.entries(catalogs))("%s has no missing or blank language values", (_, copy) => {
    expect(Object.keys(copy.es).sort()).toEqual(Object.keys(copy.en).sort());
    for (const key of Object.keys(copy.en)) {
      expect((copy.en as Record<string, string>)[key].trim().length).toBeGreaterThan(0);
      expect((copy.es as Record<string, string>)[key].trim().length).toBeGreaterThan(0);
    }
  });

  it("all portal heading drafts have a nonblank counterpart", () => {
    expect(Object.entries(PORTAL_TRANSLATIONS).length).toBeGreaterThan(20);
    for (const [english, spanish] of Object.entries(PORTAL_TRANSLATIONS)) {
      expect(english.trim()).not.toBe("");
      expect(spanish.trim()).not.toBe("");
      if (english !== "Normal") expect(spanish).not.toBe(english);
    }
  });

  it("retains non-payment proof and English-controlling legal warnings in both languages", () => {
    expect(SIGNING_COPY.en.noReceipt).toMatch(/not a receipt/);
    expect(SIGNING_COPY.es.noReceipt).toMatch(/no son recibos/);
    expect(SIGNING_COPY.es.legal).toMatch(/inglés/);
    expect(ESTIMATE_COPY.es.finalReviewBody).toContain("Ninguna cifra");
    expect(FORM_COPY.es.requestNotBooked).toContain("no una cita confirmada");
  });
});
