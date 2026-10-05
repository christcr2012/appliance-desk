import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: mocks.settings,
  parseServiceArea: (settings: { serviceAreaCities?: unknown; serviceAreaZips?: unknown }) => ({
    cities: Array.isArray(settings.serviceAreaCities) ? settings.serviceAreaCities : [],
    zips: Array.isArray(settings.serviceAreaZips) ? settings.serviceAreaZips : [],
  }),
}));

import sitemap from "@/app/sitemap";
import {
  generateMetadata as privacyMetadata,
  LEGAL_PAGE_VERSION as PRIVACY_VERSION,
} from "@/app/(public)/privacy/page";
import {
  generateMetadata as termsMetadata,
  LEGAL_PAGE_VERSION as TERMS_VERSION,
} from "@/app/(public)/terms/page";
import {
  isLegalPageApproved,
  LEGAL_PAGE_VERSIONS,
} from "@/domains/settings/legal-approvals";

describe("legal page approval gate", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
    mocks.settings.mockReset();
  });

  it("keeps unapproved legal pages noindex and out of the sitemap", async () => {
    mocks.settings.mockResolvedValue({
      legalApprovals: {},
      serviceAreaCities: [],
      serviceAreaZips: [],
    });

    expect((await privacyMetadata()).robots).toMatchObject({ index: false });
    expect((await termsMetadata()).robots).toMatchObject({ index: false });
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).not.toContain("https://example.test/privacy");
    expect(urls).not.toContain("https://example.test/terms");
  });

  it("invalidates a previous approval when the page version changes", async () => {
    const stale = {
      privacy: { version: "older", approvedOn: new Date().toISOString(), approvedBy: "Owner" },
      terms: { version: "older", approvedOn: new Date().toISOString(), approvedBy: "Owner" },
    };
    mocks.settings.mockResolvedValue({
      legalApprovals: stale,
      serviceAreaCities: [],
      serviceAreaZips: [],
    });

    expect(isLegalPageApproved(stale, "privacy", PRIVACY_VERSION)).toBe(false);
    expect(isLegalPageApproved(stale, "terms", TERMS_VERSION)).toBe(false);
    expect((await privacyMetadata()).robots).toMatchObject({ index: false });
    expect((await termsMetadata()).robots).toMatchObject({ index: false });
  });

  it("indexes and lists only exact approved versions", async () => {
    expect(PRIVACY_VERSION).toBe(LEGAL_PAGE_VERSIONS.privacy);
    expect(TERMS_VERSION).toBe(LEGAL_PAGE_VERSIONS.terms);
    const legalApprovals = {
      privacy: { version: PRIVACY_VERSION, approvedOn: new Date().toISOString(), approvedBy: "Owner" },
      terms: { version: TERMS_VERSION, approvedOn: new Date().toISOString(), approvedBy: "Owner" },
    };
    mocks.settings.mockResolvedValue({
      legalApprovals,
      serviceAreaCities: [],
      serviceAreaZips: [],
    });

    expect((await privacyMetadata()).robots).toMatchObject({ index: true });
    expect((await termsMetadata()).robots).toMatchObject({ index: true });
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain("https://example.test/privacy");
    expect(urls).toContain("https://example.test/terms");
  });
});
