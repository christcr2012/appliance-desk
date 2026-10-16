import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/sign/[id]/actions", () => ({ signAgreementAction: vi.fn() }));
vi.mock("@/app/estimate/[id]/actions", () => ({
  approveEstimateAction: vi.fn(), requestEstimateChangesAction: vi.fn(),
  declineEstimateAction: vi.fn(),
}));

import { SignForm } from "@/app/sign/[id]/sign-form";
import { EstimateResponseForm } from "@/app/estimate/[id]/estimate-response-form";

describe("W-26 real server-rendered customer control language", () => {
  it.each(["en", "es"] as const)("signing form retains agreement and payment evidence in %s", language => {
    const html = renderToStaticMarkup(createElement(SignForm, {
      signatureRecordId: "fixture-only", initialLanguage: language,
      displayLanguage: language, deliveryOptions: [{ id: "slot", date: "2026-10-18", window: "AM" }],
    }));
    expect(html).toContain('value="');
    if (language === "es") {
      expect(html).toContain("Su nombre legal completo");
      expect(html).toContain("inglés");
      expect(html).toContain("La firma solo solicita");
    } else {
      expect(html).toContain("Your full legal name");
      expect(html).toContain("English agreement controls");
    }
  });
  it.each(["en", "es"] as const)("quote response shows independent customer action in %s", language => {
    const html = renderToStaticMarkup(createElement(EstimateResponseForm, {
      estimateId: "fixture-only", allowApproval: true, language,
    }));
    if (language === "es") {
      expect(html).toContain("Rechazar presupuesto");
      expect(html).toContain("Aprobar presupuesto");
    } else {
      expect(html).toContain("Decline estimate");
      expect(html).toContain("Approve estimate");
    }
  });
});
