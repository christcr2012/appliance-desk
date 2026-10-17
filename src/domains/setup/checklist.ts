/**
 * First-time setup checklist (W-7, D-W5): the "Get set up" card on Today.
 *
 * Every step is worked out from what is actually saved or connected, never from a tick box, so it can't
 * drift from the truth. Only the OWNER can read it (checked here, where the data is read). Nothing here
 * changes a setting, sends a message or starts a payment, and no key or secret value ever leaves this file:
 * only "connected or not" and "test or live" are reported.
 */
import { prisma } from "@/lib/prisma";
import { taxSetupGaps, type TaxSetupFacts } from "@/domains/tax/setup-readiness";

export type SetupStepKey = "business" | "service-area" | "prices" | "tax" | "payments" | "email";

export type SetupStepDTO = {
  key: SetupStepKey;
  title: string;
  done: boolean;
  /** "Done" line when done, otherwise the one thing still missing, in plain words. */
  detail: string;
  /** An existing screen where the step is fixed (checked against the route list in tests). */
  href: string;
};

export type SetupChecklist = {
  steps: SetupStepDTO[];
  doneCount: number;
  total: number;
  complete: boolean;
};

/** The order an owner should work through setup. */
export const SETUP_STEP_ORDER: readonly SetupStepKey[] = [
  "business", "service-area", "prices", "tax", "payments", "email",
];

export type SetupEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
};

function liveEnv(): SetupEnv {
  return {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  };
}

/** Empty, or still the starting placeholder such as "[Company Name]". */
export function isPlaceholderDetail(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  return text.length === 0 || /^\[.*\]$/.test(text);
}

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function businessDetailsStep(settings: {
  publicBusinessName: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  publicAddress: string | null;
} | null): Pick<SetupStepDTO, "done" | "detail"> {
  const missing = [
    isPlaceholderDetail(settings?.publicBusinessName) && "business name",
    isPlaceholderDetail(settings?.publicPhone) && "phone number",
    isPlaceholderDetail(settings?.publicEmail) && "email address",
    isPlaceholderDetail(settings?.publicAddress) && "business address",
  ].filter((item): item is string => Boolean(item));
  return missing.length
    ? { done: false, detail: `Add your ${joinWords(missing)}.` }
    : { done: true, detail: "Your business name, phone, email and address are filled in." };
}

export function serviceAreaStep(settings: {
  serviceAreaCities: unknown;
  serviceAreaZips: unknown;
} | null): Pick<SetupStepDTO, "done" | "detail"> {
  const clean = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const cities = clean(settings?.serviceAreaCities).length;
  const zips = clean(settings?.serviceAreaZips).length;
  if (cities + zips === 0) return { done: false, detail: "Add the cities or ZIP codes you serve." };
  const parts = [
    cities > 0 && `${cities} ${cities === 1 ? "city" : "cities"}`,
    zips > 0 && `${zips} ZIP ${zips === 1 ? "code" : "codes"}`,
  ].filter((item): item is string => Boolean(item));
  return { done: true, detail: `You serve ${parts.join(" and ")}.` };
}

export function pricesStep(pricedAppliances: number, pricedSets: number): Pick<SetupStepDTO, "done" | "detail"> {
  if (pricedAppliances + pricedSets === 0) {
    return { done: false, detail: "Set a monthly price for at least one appliance or set." };
  }
  const parts = [
    pricedAppliances > 0 && `${pricedAppliances} ${pricedAppliances === 1 ? "appliance" : "appliances"}`,
    pricedSets > 0 && `${pricedSets} ${pricedSets === 1 ? "set" : "sets"}`,
  ].filter((item): item is string => Boolean(item));
  return { done: true, detail: `${joinWords(parts)} ${pricedAppliances + pricedSets === 1 ? "has" : "have"} a monthly price.` };
}

const FREQUENCY_WORDS: Record<string, string> = {
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  ANNUAL: "once a year",
};

export function taxStep(facts: TaxSetupFacts): Pick<SetupStepDTO, "done" | "detail"> {
  const gaps = taxSetupGaps(facts);
  if (gaps.length > 0) {
    const more = gaps.length - 1;
    return {
      done: false,
      detail: more > 0 ? `${gaps[0]} ${more} more after that.` : gaps[0],
    };
  }
  const account = facts.accounts.find(candidate => candidate.kind === "SALES_RETURN");
  const how = FREQUENCY_WORDS[account?.frequency ?? ""] ?? "on your schedule";
  return {
    done: true,
    detail: `Sales tax account on file, filed ${how}. Business address confirmed and use-tax accounts linked.`,
  };
}

/** Test and live Stripe keys look like sk_test_… / rk_live_…; the value itself is never returned. */
export function paymentsStep(env: SetupEnv): Pick<SetupStepDTO, "done" | "detail"> {
  const key = env.STRIPE_SECRET_KEY ?? "";
  const mode = /^(sk|rk)_test_/.test(key) ? "test" : /^(sk|rk)_live_/.test(key) ? "live" : null;
  if (!mode) {
    return {
      done: false,
      detail: "Payments aren't connected yet. The Stripe key is added once in your hosting settings, not in this app; see the go-live checklist.",
    };
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return {
      done: false,
      detail: "Stripe is connected, but payment updates aren't, so paid bills can't mark themselves paid. Add the payment-sync secret in your hosting settings.",
    };
  }
  return {
    done: true,
    detail: mode === "test"
      ? "Connected in test mode, so no real money moves yet."
      : "Connected with a live key.",
  };
}

export function emailStep(env: SetupEnv, customerEmailEnabled: boolean): Pick<SetupStepDTO, "done" | "detail"> {
  if (!env.RESEND_API_KEY) {
    return {
      done: false,
      detail: "The email service isn't connected yet. Its key is added once in your hosting settings, not in this app.",
    };
  }
  if (!env.RESEND_FROM_EMAIL) {
    return {
      done: false,
      detail: "Email is connected but has no sender address yet (the address customers see mail from). Add it in your hosting settings.",
    };
  }
  if (!customerEmailEnabled) {
    return {
      done: false,
      detail: "Customer emails are switched off. Turn them on in Settings → Notifications when you're ready.",
    };
  }
  return { done: true, detail: "Connected, and customer emails are on." };
}

export type SetupFacts = {
  settings: {
    publicBusinessName: string | null;
    publicPhone: string | null;
    publicEmail: string | null;
    publicAddress: string | null;
    serviceAreaCities: unknown;
    serviceAreaZips: unknown;
    customerEmailEnabled: boolean;
  } | null;
  pricedAppliances: number;
  pricedSets: number;
  tax: TaxSetupFacts;
  env: SetupEnv;
};

/** Pure: assembles the six steps, in order, from plain facts. */
export function buildSetupChecklist(facts: SetupFacts): SetupChecklist {
  const byKey: Record<SetupStepKey, Omit<SetupStepDTO, "key">> = {
    business: {
      title: "Business details",
      href: "/desk/settings?section=profile",
      ...businessDetailsStep(facts.settings),
    },
    "service-area": {
      title: "Service area",
      href: "/desk/settings?section=service-area",
      ...serviceAreaStep(facts.settings),
    },
    prices: {
      title: "Prices",
      href: "/desk/settings?section=products",
      ...pricesStep(facts.pricedAppliances, facts.pricedSets),
    },
    tax: {
      title: "Tax setup",
      href: "/desk/sales-tax/setup",
      ...taxStep(facts.tax),
    },
    payments: {
      title: "Payments",
      href: "/desk/settings?section=integrations",
      ...paymentsStep(facts.env),
    },
    email: {
      title: "Email",
      href: "/desk/settings?section=notifications",
      ...emailStep(facts.env, facts.settings?.customerEmailEnabled === true),
    },
  };
  const steps = SETUP_STEP_ORDER.map(key => ({ key, ...byKey[key] }));
  const doneCount = steps.filter(step => step.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length };
}

/**
 * OWNER only. The role is checked here, at the read, so an admin or staff caller is refused even if a page
 * forgot to hide the card. `env` is injectable so tests can prove every connected/not-connected state.
 */
export async function getSetupChecklist(
  actorUserId: string,
  env: SetupEnv = liveEnv(),
): Promise<SetupChecklist> {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { role: true, archivedAt: true },
  });
  if (!actor || actor.archivedAt || actor.role !== "OWNER") {
    throw new Error("Only the owner can see the setup checklist.");
  }
  const [settings, pricedAppliances, pricedSets, accounts, activeAccountCount, configuredStartCount,
    businessLocation] = await Promise.all([
    prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: {
        publicBusinessName: true, publicPhone: true, publicEmail: true, publicAddress: true,
        serviceAreaCities: true, serviceAreaZips: true, customerEmailEnabled: true,
      },
    }),
    prisma.applianceType.count({ where: { isActive: true, monthlyPriceCents: { gt: 0 } } }),
    prisma.rentalPackage.count({ where: { isActive: true, monthlyPriceCents: { gt: 0 } } }),
    prisma.taxFilingAccount.findMany({
      where: { active: true },
      select: {
        name: true, kind: true, accountNumber: true, portalUrl: true,
        firstPeriodStart: true, basis: true, frequency: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 200,
    }),
    prisma.taxFilingAccount.count({ where: { active: true } }),
    prisma.taxFilingAccount.count({ where: { active: true, firstPeriodStart: { not: null } } }),
    prisma.addressTaxLocation.findFirst({
      where: { forBusinessLocation: true, isCurrent: true },
      select: {
        status: true,
        jurisdictions: { select: { jurisdiction: { select: { useTaxFilingAccountId: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);
  return buildSetupChecklist({
    settings,
    pricedAppliances,
    pricedSets,
    tax: { accounts, activeAccountCount, configuredStartCount, businessLocation },
    env,
  });
}
