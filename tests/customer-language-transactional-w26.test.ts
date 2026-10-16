import { describe, expect, it } from "vitest";
import { followUpEmailCopy, quoteEmailCopy } from "@/domains/language/transactional-copy";

const request = {
  businessName: "Robinson Appliance Rentals",
  estimateNumber: 251,
  recipientName: "Ana",
  monthlyCents: 6050,
  oneTimeCents: 4500,
  fullyReviewed: false,
  clientMessage: null,
  url: "https://example.test/estimate/token",
};

describe("W-26 translated quote delivery", () => {
  it.each(["en", "es"] as const)("preserves identical dollars and secure link in %s", language => {
    const copy = quoteEmailCopy(language, request);
    expect(copy.text).toContain("$60.50");
    expect(copy.text).toContain("$45.00");
    expect(copy.text).toContain(request.url);
    expect(copy.text).toContain("Ana");
    expect(copy.text).not.toContain("sk_test");
    expect(copy.subject).toContain("251");
  });
  it("preserves non-binding warning in both languages", () => {
    expect(quoteEmailCopy("en", request).text).toContain("cannot approve or pay");
    expect(quoteEmailCopy("es", request).text).toContain("No puede aceptar ni pagar");
  });
  it("cannot omit the reviewed-order distinction", () => {
    expect(quoteEmailCopy("en", {...request, fullyReviewed:true}).text).toContain("reviewed all-in");
    expect(quoteEmailCopy("es", {...request, fullyReviewed:true}).text).toContain("desglose revisado");
  });
});

describe("W-26 original and reminder language consistency", () => {
  const input = { name: "Ana", businessName: "Robinson Appliance Rentals", number: 251,
    url: "https://example.test/estimate/token" };
  it.each(["en", "es"] as const)("preserves link, quote identifier and reply behavior for %s", language => {
    const notice = followUpEmailCopy(language, input);
    expect(notice.subject).toContain("251");
    expect(notice.text).toContain(input.url);
    expect(notice.text).toContain("Ana");
    expect(notice.actionLabel).not.toBe("");
  });
  it("keeps Spanish followups informational and retains a no-login secure link", () => {
    expect(followUpEmailCopy("es", input).text).toContain("sin iniciar sesión");
  });
});
