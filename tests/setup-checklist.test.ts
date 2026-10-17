import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ACCESSIBILITY_ROUTES } from "../e2e/route-inventory";
import { SETTINGS_SECTIONS } from "@/domains/settings/section-config";
import {
  SETUP_STEP_ORDER,
  buildSetupChecklist,
  businessDetailsStep,
  emailStep,
  isPlaceholderDetail,
  paymentsStep,
  pricesStep,
  serviceAreaStep,
  taxStep,
  type SetupEnv,
  type SetupFacts,
} from "@/domains/setup/checklist";
import {
  allFilingStartsRecorded,
  hasCompleteSalesAccount,
  taxSetupGaps,
  areUseTaxAccountsLinked,
  type BusinessTaxLocationFacts,
  type SetupFilingAccountFacts,
  type TaxSetupFacts,
} from "@/domains/tax/setup-readiness";

const STRIPE_TEST = ["sk_test_","NotARealKeyOnlyForTests123"].join("");
const STRIPE_LIVE = ["rk_live_","NotARealKeyOnlyForTests456"].join("");
const WEBHOOK = ["whsec_","NotARealSecretOnlyForTests789"].join("");
const RESEND = ["re_","NotARealKeyOnlyForTests000"].join("");
const SECRETS = [STRIPE_TEST, STRIPE_LIVE, WEBHOOK, RESEND];

const goodAccount: SetupFilingAccountFacts = {
  name: "Colorado sales tax",
  kind: "SALES_RETURN",
  accountNumber: "12345678",
  portalUrl: "https://tax.example.test",
  firstPeriodStart: new Date("2026-10-01T06:00:00Z"),
  basis: "CASH",
  frequency: "QUARTERLY",
};
const linkedLocation: BusinessTaxLocationFacts = {
  status: "VERIFIED",
  jurisdictions: [{ jurisdiction: { useTaxFilingAccountId: "use-co" } }, { jurisdiction: { useTaxFilingAccountId: "use-greeley" } }],
};
const goodTax: TaxSetupFacts = {
  accounts: [goodAccount],
  activeAccountCount: 1,
  configuredStartCount: 1,
  businessLocation: linkedLocation,
};
const goodSettings: SetupFacts["settings"] = {
  publicBusinessName: "Robinson Appliance Rentals",
  publicPhone: "(970) 555-0100",
  publicEmail: "hello@robinson.example.test",
  publicAddress: "1 Main St, Greeley, CO",
  serviceAreaCities: ["Greeley"],
  serviceAreaZips: ["80631"],
  customerEmailEnabled: true,
};
const goodEnv: SetupEnv = {
  STRIPE_SECRET_KEY: STRIPE_TEST, STRIPE_WEBHOOK_SECRET: WEBHOOK,
  RESEND_API_KEY: RESEND, RESEND_FROM_EMAIL: "Robinson <hello@robinson.example.test>",
};
const allDone: SetupFacts = { settings: goodSettings, pricedAppliances: 2, pricedSets: 1, tax: goodTax, env: goodEnv };

describe("business details step", () => {
  it("treats empty text and the starting [placeholders] as missing", () => {
    for (const value of ["", "   ", null, undefined, "[Company Name]", "[Phone Number]", " [Email Address] "]) {
      expect(isPlaceholderDetail(value), String(value)).toBe(true);
    }
    for (const value of ["Robinson Appliance Rentals", "(970) 555-0100", "Unit [4] rear"]) {
      expect(isPlaceholderDetail(value), value).toBe(false);
    }
  });
  it("names only what is missing, in plain words", () => {
    const placeholders = { publicBusinessName: "[Company Name]", publicPhone: "[Phone Number]", publicEmail: "[Email Address]", publicAddress: "[Business Address]" };
    expect(businessDetailsStep(placeholders)).toEqual({ done: false, detail: "Add your business name, phone number, email address and business address." });
    expect(businessDetailsStep(null).done).toBe(false);
    expect(businessDetailsStep({ ...placeholders, publicBusinessName: "Robinson", publicEmail: "a@b.test", publicAddress: "1 Main" }))
      .toEqual({ done: false, detail: "Add your phone number." });
    expect(businessDetailsStep({ ...placeholders, publicBusinessName: "Robinson", publicEmail: "a@b.test" }))
      .toEqual({ done: false, detail: "Add your phone number and business address." });
    expect(businessDetailsStep(goodSettings!).done).toBe(true);
  });
});

describe("service area step", () => {
  it("needs at least one real city or ZIP code", () => {
    expect(serviceAreaStep(null)).toEqual({ done: false, detail: "Add the cities or ZIP codes you serve." });
    expect(serviceAreaStep({ serviceAreaCities: [], serviceAreaZips: [] }).done).toBe(false);
    expect(serviceAreaStep({ serviceAreaCities: [" ", ""], serviceAreaZips: [] }).done).toBe(false);
    expect(serviceAreaStep({ serviceAreaCities: "Greeley", serviceAreaZips: {} }).done).toBe(false);
  });
  it("says what is saved", () => {
    expect(serviceAreaStep({ serviceAreaCities: ["Greeley"], serviceAreaZips: [] })).toEqual({ done: true, detail: "You serve 1 city." });
    expect(serviceAreaStep({ serviceAreaCities: ["Greeley", "Evans"], serviceAreaZips: ["80631", "80634", "80620"] }))
      .toEqual({ done: true, detail: "You serve 2 cities and 3 ZIP codes." });
  });
});

describe("prices step", () => {
  it("needs a monthly price above $0 on an active appliance or set", () => {
    expect(pricesStep(0, 0)).toEqual({ done: false, detail: "Set a monthly price for at least one appliance or set." });
    expect(pricesStep(1, 0)).toEqual({ done: true, detail: "1 appliance has a monthly price." });
    expect(pricesStep(0, 1)).toEqual({ done: true, detail: "1 set has a monthly price." });
    expect(pricesStep(1, 1)).toEqual({ done: true, detail: "1 appliance and 1 set have a monthly price." });
    expect(pricesStep(3, 2)).toEqual({ done: true, detail: "3 appliances and 2 sets have a monthly price." });
  });
});

describe("tax setup step", () => {
  it("is done, and says how often you file, when everything is in place", () => {
    const step = taxStep(goodTax);
    expect(step.done).toBe(true);
    expect(step.detail).toContain("filed quarterly");
    expect(taxStep({ ...goodTax, accounts: [{ ...goodAccount, frequency: "MONTHLY" }] }).detail).toContain("filed monthly");
    expect(taxStep({ ...goodTax, accounts: [{ ...goodAccount, frequency: "ANNUAL" }] }).detail).toContain("filed once a year");
  });
  it("shows the one next thing, and how many more follow", () => {
    expect(taxStep({ accounts: [], activeAccountCount: 0, configuredStartCount: 0, businessLocation: null }))
      .toEqual({ done: false, detail: "Add your Colorado sales tax account. 2 more after that." });
    expect(taxStep({ ...goodTax, accounts: [{ ...goodAccount, accountNumber: null }] }).detail)
      .toBe("Enter your sales tax account number.");
    expect(taxStep({ ...goodTax, accounts: [{ ...goodAccount, accountNumber: "", basis: "UNDECIDED", firstPeriodStart: null, portalUrl: null }], configuredStartCount: 0 }).detail)
      .toBe("Enter your sales tax account number, how you report sales tax (cash or accrual; ask your accountant if unsure), your first filing period, the website you file on. 1 more after that.");
  });
  it("asks to confirm the business address, then to link use-tax accounts", () => {
    expect(taxStep({ ...goodTax, businessLocation: null }).detail).toBe("Confirm your business address for tax.");
    expect(taxStep({ ...goodTax, businessLocation: { ...linkedLocation, status: "NEEDS_REVIEW" } }).detail).toBe("Confirm your business address for tax.");
    expect(taxStep({ ...goodTax, businessLocation: { status: "VERIFIED", jurisdictions: [] } }).detail).toBe("Confirm your business address for tax.");
    expect(taxStep({ ...goodTax, businessLocation: { status: "VERIFIED", jurisdictions: [{ jurisdiction: { useTaxFilingAccountId: null } }] } }).detail)
      .toBe("Link a use-tax account for 1 tax area (Colorado and Greeley).");
    expect(taxStep({ ...goodTax, businessLocation: { status: "VERIFIED", jurisdictions: [{ jurisdiction: { useTaxFilingAccountId: null } }, { jurisdiction: { useTaxFilingAccountId: null } }] } }).detail)
      .toBe("Link a use-tax account for 2 tax areas (Colorado and Greeley).");
  });
  it("asks for a first filing period for every filing account", () => {
    expect(taxStep({ ...goodTax, activeAccountCount: 2, configuredStartCount: 1 }).detail)
      .toBe("Set the first filing period for every filing account.");
  });
  it("agrees with the shared Taxes → Setup definition for every combination", () => {
    const accountVariants: SetupFilingAccountFacts[][] = [
      [],
      [{ ...goodAccount, accountNumber: null }],
      [{ ...goodAccount, basis: "UNDECIDED" }],
      [{ ...goodAccount, firstPeriodStart: null }],
      [{ ...goodAccount, portalUrl: null }],
      [{ ...goodAccount, kind: "USE_TAX_RETURN" }],
      [goodAccount],
    ];
    const locationVariants: Array<BusinessTaxLocationFacts | null> = [
      null,
      { ...linkedLocation, status: "NEEDS_REVIEW" },
      { status: "VERIFIED", jurisdictions: [] },
      { status: "VERIFIED", jurisdictions: [{ jurisdiction: { useTaxFilingAccountId: null } }, { jurisdiction: { useTaxFilingAccountId: "x" } }] },
      linkedLocation,
    ];
    let combinations = 0;
    for (const accounts of accountVariants) for (const businessLocation of locationVariants)
      for (const [activeAccountCount, configuredStartCount] of [[0, 0], [1, 0], [1, 1], [2, 1]]) {
        const facts: TaxSetupFacts = { accounts, activeAccountCount, configuredStartCount, businessLocation };
        const shared = hasCompleteSalesAccount(accounts) && areUseTaxAccountsLinked(businessLocation) &&
          allFilingStartsRecorded(activeAccountCount, configuredStartCount);
        expect(taxSetupGaps(facts).length === 0, JSON.stringify(facts)).toBe(shared);
        expect(taxStep(facts).done).toBe(shared);
        combinations++;
      }
    expect(combinations).toBe(7 * 5 * 4);
  });
});

describe("payments step", () => {
  it("is not done without a recognized Stripe key", () => {
    for (const key of [undefined, "", "garbage", "pk_test_publishable", "sk_prod_x"]) {
      const step = paymentsStep({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WEBHOOK });
      expect(step.done, String(key)).toBe(false);
      expect(step.detail).toContain("Payments aren't connected yet");
    }
  });
  it("is not done while payment updates (the sync secret) are missing", () => {
    for (const key of [STRIPE_TEST, STRIPE_LIVE]) {
      const step = paymentsStep({ STRIPE_SECRET_KEY: key });
      expect(step.done).toBe(false);
      expect(step.detail).toContain("payment updates aren't");
    }
  });
  it("is done with a test or live key plus the sync secret, and says which", () => {
    expect(paymentsStep({ STRIPE_SECRET_KEY: STRIPE_TEST, STRIPE_WEBHOOK_SECRET: WEBHOOK }))
      .toEqual({ done: true, detail: "Connected in test mode, so no real money moves yet." });
    expect(paymentsStep({ STRIPE_SECRET_KEY: STRIPE_LIVE, STRIPE_WEBHOOK_SECRET: WEBHOOK }))
      .toEqual({ done: true, detail: "Connected with a live key." });
  });
});

describe("email step", () => {
  it("reports the first thing missing: service, sender address, then the customer-email switch", () => {
    expect(emailStep({}, true).detail).toContain("email service isn't connected");
    expect(emailStep({ RESEND_FROM_EMAIL: "a@b.test" }, true).detail).toContain("email service isn't connected");
    expect(emailStep({ RESEND_API_KEY: RESEND }, true).detail).toContain("no sender address");
    expect(emailStep({ RESEND_API_KEY: RESEND, RESEND_FROM_EMAIL: "a@b.test" }, false).detail)
      .toBe("Customer emails are switched off. Turn them on in Settings → Notifications when you're ready.");
    for (const enabled of [false, true]) expect(emailStep({}, enabled).done).toBe(false);
  });
  it("is done only when the service, sender address and switch are all set", () => {
    expect(emailStep({ RESEND_API_KEY: RESEND, RESEND_FROM_EMAIL: "a@b.test" }, true))
      .toEqual({ done: true, detail: "Connected, and customer emails are on." });
  });
});

describe("the assembled checklist", () => {
  it("lists the six steps in the required order", () => {
    expect(SETUP_STEP_ORDER).toEqual(["business", "service-area", "prices", "tax", "payments", "email"]);
    const checklist = buildSetupChecklist(allDone);
    expect(checklist.steps.map(step => step.key)).toEqual(SETUP_STEP_ORDER);
    expect(checklist.steps.map(step => step.title)).toEqual(["Business details", "Service area", "Prices", "Tax setup", "Payments", "Email"]);
  });
  it("is complete only when all six are done, and counts honestly", () => {
    const complete = buildSetupChecklist(allDone);
    expect(complete).toMatchObject({ doneCount: 6, total: 6, complete: true });
    const empty = buildSetupChecklist({
      settings: null, pricedAppliances: 0, pricedSets: 0,
      tax: { accounts: [], activeAccountCount: 0, configuredStartCount: 0, businessLocation: null }, env: {},
    });
    expect(empty).toMatchObject({ doneCount: 0, total: 6, complete: false });
    expect(empty.steps.every(step => !step.done && step.detail.length > 0)).toBe(true);
    // Breaking any single step un-completes the whole list.
    const breakers: Array<Partial<SetupFacts>> = [
      { settings: { ...goodSettings!, publicPhone: "[Phone Number]" } },
      { settings: { ...goodSettings!, serviceAreaCities: [], serviceAreaZips: [] } },
      { pricedAppliances: 0, pricedSets: 0 },
      { tax: { ...goodTax, businessLocation: null } },
      { env: { ...goodEnv, STRIPE_WEBHOOK_SECRET: undefined } },
      { settings: { ...goodSettings!, customerEmailEnabled: false } },
    ];
    breakers.forEach((change, index) => {
      const result = buildSetupChecklist({ ...allDone, ...change });
      expect(result.complete, "breaker " + index).toBe(false);
      expect(result.doneCount, "breaker " + index).toBe(5);
      expect(result.steps.filter(step => !step.done).map(step => step.key)).toEqual([SETUP_STEP_ORDER[index]]);
    });
  });
  it("never lets a key or secret value reach the result", () => {
    const text = JSON.stringify([
      buildSetupChecklist(allDone),
      buildSetupChecklist({ ...allDone, env: { STRIPE_SECRET_KEY: STRIPE_LIVE, RESEND_API_KEY: RESEND } }),
      buildSetupChecklist({ ...allDone, env: { ...goodEnv, RESEND_FROM_EMAIL: undefined } }),
    ]);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain("hello@robinson.example.test <");
  });
  it("links every step to a Settings section or desk page that exists", () => {
    const routeExists = (pathname: string) => ACCESSIBILITY_ROUTES.some(route => route.path === pathname);
    const sectionIds = new Set<string>(SETTINGS_SECTIONS.map(section => section.id));
    for (const step of buildSetupChecklist(allDone).steps) {
      const url = new URL(step.href, "https://example.test");
      expect(routeExists(url.pathname), step.href).toBe(true);
      if (url.pathname === "/desk/settings") {
        expect(sectionIds.has(url.searchParams.get("section") ?? ""), step.href).toBe(true);
      }
    }
  });
});
