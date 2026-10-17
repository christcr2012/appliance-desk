import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_CATALOG, FIXTURE_SETTINGS, visibleLines } from "./helpers/public-pages";

const state = vi.hoisted(() => ({ legal: false, photos: false, lead: null as null | ((v: unknown) => Promise<unknown>), launch: null as null | ((s: unknown, f: unknown) => Promise<unknown>), prelaunch: false, emptyCatalog: false, noCities: false, content: {} as Record<string, string>, values: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// eslint-disable-next-line @next/next/no-img-element -- test stand-in for next/image
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock("@/domains/settings", async (orig) => ({ ...(await orig<typeof import("@/domains/settings")>()), getBusinessSettings: async () => (state.noCities ? { ...FIXTURE_SETTINGS, serviceAreaCities: [], serviceAreaZips: [] } : FIXTURE_SETTINGS) }));
vi.mock("@/domains/launch", () => ({ getLaunchSettings: async () => ({ prelaunchMode: state.prelaunch, emailEnabled: false, postalAddress: "", replyToEmail: "" }) }));
vi.mock("@/domains/pricing", async (orig) => ({ ...(await orig<typeof import("@/domains/pricing")>()), getPublishedCatalog: async () => (state.emptyCatalog ? [] : state.photos ? [{ ...FIXTURE_CATALOG[0] }, { ...FIXTURE_CATALOG[0], id: "t2", slug: "dryer", name: "Dryer" }, { ...FIXTURE_CATALOG[1], slug: "washer-dryer-set" }].map((c) => ({ ...c, photoUrl: "https://photos.example/" + c.slug + ".jpg" })) : FIXTURE_CATALOG) }));
vi.mock("@/domains/settings/legal-approvals", async (orig) => ({ ...(await orig<typeof import("@/domains/settings/legal-approvals")>()), isLegalPageApproved: () => state.legal }));
vi.mock("@/domains/site-content", async (orig) => ({ ...(await orig<typeof import("@/domains/site-content")>()), getPublishedContent: async () => state.content }));
vi.mock("@/domains/site-content/request", () => ({
  getContentForRequest: async () => state.content,
  getSiteForRequest: async () => ({ text: state.content, values: { ...siteDefaultTypedValues(), ...state.values }, preview: false, now: new Date() }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => { throw new Error("database used in a render test"); } }) }));
vi.mock("@/lib/session", () => ({ getServerSession: async () => null, requireSession: async () => { throw new Error("no session"); } }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@vercel/blob", () => ({}));
vi.mock("@/app/(public)/contact/actions", () => ({ submitLead: (v: unknown) => (state.lead ? state.lead(v) : Promise.resolve({})), submitContactLead: async () => ({}) }));
vi.mock("@/app/(public)/launch/actions", () => ({ submitLaunchSignup: (st: unknown, f: unknown) => (state.launch ? state.launch(st, f) : Promise.resolve({ status: "idle" })) }));
vi.mock("@/lib/metricool", () => ({ metricoolConfig: () => null }));

import { SITE_FIELDS, siteDefaults, siteDefaultTypedValues } from "@/domains/site-content/fields";
import { hoursLines, upcomingClosures } from "@/domains/settings/profile-extras";
import PublicLayout from "@/app/(public)/layout";
import HomePage from "@/app/(public)/page";
import PricingPage from "@/app/(public)/pricing/page";
import ContactPage from "@/app/(public)/contact/page";
import HowItWorksPage from "@/app/(public)/how-it-works/page";
import ServiceAreaPage from "@/app/(public)/service-area/page";
import LaunchPage from "@/app/(public)/launch/page";
import CityPage from "@/app/(public)/rent/[city]/page";
import PrivacyPage from "@/app/(public)/privacy/page";
import TermsPage from "@/app/(public)/terms/page";
import AccessibilityPage from "@/app/(public)/accessibility/page";

const sp = Promise.resolve({});
type Route = { name: string; prelaunch: boolean; page: () => Promise<React.ReactElement> };
export const ROUTES: Route[] = [
  { name: "home-live", prelaunch: false, page: async () => await HomePage({ searchParams: sp }) },
  { name: "home-prelaunch", prelaunch: true, page: async () => await HomePage({ searchParams: sp }) },
  { name: "pricing", prelaunch: false, page: async () => await PricingPage({ searchParams: sp }) },
  { name: "contact", prelaunch: false, page: async () => await ContactPage({ searchParams: sp }) },
  { name: "how-it-works", prelaunch: false, page: async () => await HowItWorksPage({ searchParams: sp }) },
  { name: "service-area", prelaunch: false, page: async () => await (ServiceAreaPage as (p: unknown) => Promise<React.ReactElement>)({ searchParams: sp }) },
  { name: "launch-open", prelaunch: true, page: async () => await (LaunchPage as (p?: unknown) => Promise<React.ReactElement>)({ searchParams: sp }) },
  { name: "launch-closed", prelaunch: false, page: async () => await (LaunchPage as (p?: unknown) => Promise<React.ReactElement>)({ searchParams: sp }) },
  { name: "contact-prelaunch", prelaunch: true, page: async () => await ContactPage({ searchParams: sp }) },
  { name: "rent-greeley", prelaunch: false, page: async () => await (CityPage as (p: unknown) => Promise<React.ReactElement>)({ params: Promise.resolve({ city: "greeley" }), searchParams: sp }) },
  { name: "privacy", prelaunch: false, page: async () => await PrivacyPage({ searchParams: sp }) },
  { name: "terms", prelaunch: false, page: async () => await TermsPage() },
  { name: "accessibility", prelaunch: false, page: async () => <>{await (AccessibilityPage as unknown as () => Promise<React.ReactElement> | React.ReactElement)()}</> },
];

async function render(route: Route) {
  state.prelaunch = route.prelaunch;
  const body = await route.page();
  const layout = await PublicLayout({ children: body });
  return visibleLines(layout as React.ReactElement).join("\n") + "\n";
}

beforeEach(() => { state.content = siteDefaults(); state.values = {}; state.emptyCatalog = false; state.noCities = false; state.legal = false; state.photos = false; state.lead = null; state.launch = null; });

describe("public pages show exactly today's words when nothing has been changed", () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      await expect(await render(route)).toMatchFileSnapshot(`./fixtures/public-pages/${route.name}.txt`);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Coverage: every editable item shows its own marker, and nothing else on a page is a word the owner cannot change.
// ---------------------------------------------------------------------------------------------------------------------
const MARK = (key: string) => `⟦${key}⟧`;
// Pages whose body is a legal text tied to a legal-approval version (not casual website text).
const LEGAL_ROUTES = new Set(["privacy", "terms", "accessibility"]);
const EDITABLE = SITE_FIELDS.filter((f) => (f.valueKind ?? "text") === "text" || f.valueKind === "link").filter((f) => !f.key.startsWith("seo."));

function markedState() {
  const text: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  for (const f of EDITABLE) {
    if ((f.valueKind ?? "text") === "text") text[f.key] = MARK(f.key);
    else values[f.key] = { ...(siteDefaultTypedValues()[f.key] as object), label: MARK(f.key) };
  }
  return { text, values };
}

// Words that are not website content: owner-source facts (Settings, prices, catalog, service area) and named exceptions.
function allowedFacts(): Set<string> {
  const s = FIXTURE_SETTINGS as Record<string, unknown>;
  const set = new Set<string>([
    String(s.publicBusinessName), String(s.publicPhone), String(s.publicEmail), String(s.publicAddress),
    ...hoursLines(s.hours), ...upcomingClosures(s.holidayClosures).map((c) => c.text),
    "Facebook", ...(s.serviceAreaCities as string[]), ...(s.serviceAreaZips as string[]),
    ...FIXTURE_CATALOG.map((c) => c.name), ...FIXTURE_CATALOG.filter((c) => c.contents).map((c) => `${c.name} (${c.contents})`), "$35", "$60", "$25", "$15", "$25.00", "$15.00", "$35.00", "$60.00",
    "01", "02", "03", "04", "© YEAR",
  ]);
  return set;
}
const NAMED_EXCEPTIONS = new Set([
  // landmarks and controls whose words are part of the page's structure, not marketing copy
  "Primary", "Legal", "Open menu", "Close menu", "Find us online", "Skip to main content", "Leave this field blank", "Website",
  "Promotion", "Featured offer",
  // choices that are stored values of the lead form and the rental agreement (contract terms), not marketing copy
  "Month-to-month", "6 months", "12 months",
  "Washer and dryer", "Washer", "Dryer", "Multiple properties", "Still deciding",
  // the launch-list email consent: legal wording tied to LAUNCH_CONSENT_VERSION, not casual text
  "Email me launch news and appliance-rental information from Robinson Appliance Rentals. I can unsubscribe at any time.",
]);
function strayLines(lines: string[]): string[] {
  const facts = allowedFacts();
  return lines.filter((l) => {
    if (l.includes("⟦")) return false;
    if (/^\[(a href|img src)\]/.test(l)) return false;
    const stripped = l.replace(/^\[[^\]]+\]\s*/, "");
    if (facts.has(stripped) || NAMED_EXCEPTIONS.has(stripped)) return false;
    if (/^[\s.,;:·\-—–/()|]*$/.test(stripped)) return false;
    return true;
  });
}

const seen = new Set<string>();
function noteMarkers(text: string) { for (const m of text.matchAll(/⟦([^⟧]+)⟧/g)) seen.add(m[1]); }

describe("runtime coverage with every editable item replaced by a marker", () => {
  const variants: Route[] = [
    ...ROUTES,
    { name: "pricing-empty", prelaunch: false, page: async () => { state.emptyCatalog = true; return await PricingPage({ searchParams: sp }); } },
    { name: "home-empty", prelaunch: false, page: async () => { state.emptyCatalog = true; return await HomePage({ searchParams: sp }); } },
    { name: "rent-empty", prelaunch: false, page: async () => { state.emptyCatalog = true; return await (CityPage as (p: unknown) => Promise<React.ReactElement>)({ params: Promise.resolve({ city: "greeley" }), searchParams: sp }); } },
    { name: "pricing-photos", prelaunch: false, page: async () => { state.photos = true; return await PricingPage({ searchParams: sp }); } },
    { name: "home-photos", prelaunch: false, page: async () => { state.photos = true; return await HomePage({ searchParams: sp }); } },
    { name: "contact-no-options", prelaunch: false, page: async () => { state.emptyCatalog = true; return await ContactPage({ searchParams: sp }); } },
    { name: "home-legal-approved", prelaunch: false, page: async () => { state.legal = true; return await HomePage({ searchParams: sp }); } },
    { name: "area-empty", prelaunch: false, page: async () => { state.noCities = true; return await (ServiceAreaPage as (p: unknown) => Promise<React.ReactElement>)({ searchParams: sp }); } },
  ];
  for (const route of variants) {
    it(`${route.name}: every word is an editable item (marker) or a declared owner fact`, async () => {
      const marked = markedState();
      state.content = { ...siteDefaults(), ...marked.text };
      state.values = marked.values;
      state.prelaunch = route.prelaunch;
      const body = await route.page();
      const lines = visibleLines((await PublicLayout({ children: body })) as React.ReactElement);
      for (const l of lines) noteMarkers(l);
      if (LEGAL_ROUTES.has(route.name)) return; // legal bodies are declared exceptions; their chrome is checked above
      expect(strayLines(lines), `${route.name} shows words the owner cannot change`).toEqual([]);
    });
  }
});

// Words that only appear after the visitor does something (choosing "business", sending, getting the thank-you) are
// proven with the real client forms, not a static render.
import { fireEvent, render as rtlRender, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { ContactForm } from "@/app/(public)/contact/contact-form";
import { SignupForm } from "@/app/(public)/launch/signup-form";

afterEach(() => cleanup());

describe("form words that appear after the visitor acts", () => {
  const marked = () => ({ ...siteDefaults(), ...markedState().text });

  it("contact form: company name, 'no options', sending and thank-you all come from the website items", async () => {
    let finish: (v: unknown) => void = () => {};
    state.lead = () => new Promise((resolve) => { finish = resolve; });
    rtlRender(<ContactForm applianceTypes={[]} copy={marked()} />);
    expect(screen.getByText(MARK("contact.form.noAppliances"))).toBeInTheDocument();
    noteMarkers(document.body.textContent ?? "");
    fireEvent.click(screen.getByLabelText(MARK("contact.form.business")));
    expect(screen.getByLabelText(MARK("contact.form.companyName"))).toBeInTheDocument();
    noteMarkers(document.body.textContent ?? "");
    fireEvent.change(screen.getByLabelText(new RegExp(MARK("contact.form.contactName"))), { target: { value: "Pat Customer" } });
    fireEvent.change(screen.getByLabelText(new RegExp(MARK("contact.form.phone"))), { target: { value: "5551234567" } });
    fireEvent.change(screen.getByLabelText(MARK("contact.form.companyName")), { target: { value: "Pat LLC" } });
    fireEvent.click(document.querySelector('input[name="consent"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: MARK("contact.form.submit") }));
    await waitFor(() => expect(screen.getByRole("button", { name: MARK("contact.form.sending") })).toBeInTheDocument());
    noteMarkers(document.body.textContent ?? "");
    finish({ status: "success" });
    await waitFor(() => expect(screen.getByText(MARK("contact.thanks.title"))).toBeInTheDocument());
    expect(screen.getByText(MARK("contact.thanks.body"))).toBeInTheDocument();
    noteMarkers(document.body.textContent ?? "");
  });

  it("launch sign-up: the saving words come from the website item", async () => {
    state.launch = () => new Promise(() => {});
    rtlRender(<SignupForm source="website" copy={marked()} />);
    fireEvent.change(screen.getByLabelText(new RegExp(MARK("launch.form.name"))), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText(new RegExp(MARK("launch.form.email"))), { target: { value: "pat@example.com" } });
    fireEvent.change(screen.getByLabelText(new RegExp(MARK("launch.form.city"))), { target: { value: "Greeley" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: MARK("launch.form.submit") }));
    await waitFor(() => expect(screen.getByRole("button", { name: MARK("launch.form.saving") })).toBeInTheDocument());
    noteMarkers(document.body.textContent ?? "");
  });

  it("every editable item appears on at least one page or variant", () => {
    const missing = EDITABLE.map((f) => f.key).filter((k) => !seen.has(k));
    expect(missing).toEqual([]);
  });

});
