import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// DEC-1b: the Decisions & reviews page as an owner and as an admin (read-only: same cards, no buttons).
const s = vi.hoisted(() => ({ role: "OWNER" }));
vi.mock("next/navigation", () => import("./kit/kit-test-env"));
vi.mock("@/lib/session", () => ({ requireRole: async () => ({ user: { id: "u1", role: s.role } }) }));
vi.mock("@/app/desk/settings/decisions/actions", () => ({
  keepDecisionAction: vi.fn(), changeDecisionAction: vi.fn(), askProfessionalAction: vi.fn(), reopenDecisionAction: vi.fn(),
}));
vi.mock("@/domains/decisions", async () => {
  const { DECISION_SUBJECTS } = await import("@/domains/decisions/registry");
  return {
    listDecisions: async () => DECISION_SUBJECTS.slice(0, 40).map((subject, index) => ({
      ...subject, audience: subject.audience, defaultAudience: subject.audience,
      current: { value: subject.options[0]!.value, words: "Doing it" },
      state: index % 3 === 0 ? "CONFIRMED" : index % 3 === 1 ? "WITH_PROFESSIONAL" : "NO_SOURCE",
      needsAppChange: false,
      last: index % 3 === 2 ? null : { id: `rec${index}aaaaaaaaaa`, kind: index % 3 === 0 ? "CONFIRMED" : "SENT_TO_PROFESSIONAL",
        audience: subject.audience, value: null, previousValue: null, effectiveFrom: null, answeredByName: "Chris",
        professionalName: null, professionalFirm: null, professionalAnsweredOn: null, explanation: null,
        hasAttachment: index === 3, sources: [], via: "SCREEN", createdAt: new Date("2026-10-20T12:00:00Z") },
      history: [], pending: null,
    })),
  };
});

import DecisionsPage from "@/app/desk/settings/decisions/page";

async function html(role: string, tab: string) {
  s.role = role;
  return renderToString(await DecisionsPage({ searchParams: Promise.resolve({ for: tab }) }));
}

describe("Decisions & reviews page", () => {
  it.each(["CPA", "ATTORNEY", "ANSWERED"])("owner sees the cards and their buttons (%s)", async (tab) => {
    const page = await html("OWNER", tab);
    expect(page).toContain("Decisions &amp; reviews</h1>");
    expect(page).toContain("<article");
  });

  it.each(["CPA", "ATTORNEY", "ANSWERED"])("admin sees the same cards without any button (%s)", async (tab) => {
    const page = await html("ADMIN", tab);
    expect(page).toContain("Decisions &amp; reviews</h1>");
    expect(page).toContain("<article");
    for (const words of ["Keep this", "Change…", "Ask my…", "Enter their answer…", "Reopen", "Import a completed form"]) {
      expect(page).not.toContain(`>${words}<`);
    }
  });

  it("the CPA tab offers both downloads and the stored form link", async () => {
    const page = await html("ADMIN", "CPA");
    expect(page).toContain("/desk/settings/decisions/form?for=CPA&amp;format=docx");
    expect(page).toContain("/desk/settings/decisions/form?for=CPA&amp;format=pdf");
  });
});
