import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accessEndAttentionKind,
  daysUntilAccessEnds,
  endOfDenverDayKey,
  nextMayFirstEnd,
} from "@/domains/accountant/rules";
import {
  ACCOUNTANT_SCREENS,
  accountantAllowsPath,
} from "@/domains/team/job-role-rules";
import { accountantCanSeeRecord } from "@/domains/paperwork/rules";
import { RECOMMENDED_TWO_FACTOR_ROLES, roleRequiresTwoFactor } from "@/domains/security/two-factor";

// ACCT-1 (spec section 1): the accountant level is deny-by-default. This test is the inventory of
// every surface that names ACCOUNTANT in a gate. If a change admits the role somewhere new, the
// exact-set comparisons fail until the list here is deliberately updated — that is the point:
// the allowlist can only grow on purpose, in review, never by accident.

const ROOT = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (files: string[]) => files.map((f) => f.slice(ROOT.length + 1)).sort();

function filesMatching(dir: string, pattern: RegExp): string[] {
  return rel(walk(join(ROOT, dir)).filter((f) => pattern.test(readFileSync(f, "utf8"))));
}

const APP_GATE = /requireRole\([^)]*"ACCOUNTANT"/;
const SETUP_GATE = /requireRoleForTwoFactorSetup\([^)]*"ACCOUNTANT"/;
const DECISION_GUARD = /guardDecisionRequest\([^)]*"ACCOUNTANT"/;
const DOMAIN_GATE =
  /assertActiveTeamActor\([^;]*"ACCOUNTANT"|assertBooksWriter\([^;]*"ACCOUNTANT"|allow\(actor,[^)]*"ACCOUNTANT"|actor\(tx,[^)]*"ACCOUNTANT"|READ_ROLES = \[|requireRole\([^)]*"ACCOUNTANT"/;

// Every page/action/route under src/app that may admit the accountant. Anything else — the vault,
// money actions, settings, customers, sales-tax setup — must refuse the role at its own gate.
const APP_ALLOWLIST = [
  "app/desk/account/actions.ts",
  "app/desk/account/page.tsx",
  "app/desk/billing/page.tsx",
  "app/desk/books/actions.ts",
  "app/desk/books/assets/actions.ts",
  "app/desk/books/assets/page.tsx",
  "app/desk/books/cash/checks/actions.ts",
  "app/desk/books/cash/checks/page.tsx",
  "app/desk/books/cash/page.tsx",
  "app/desk/books/export/route.ts",
  "app/desk/books/exports/actions.ts",
  "app/desk/books/exports/download/[id]/route.ts",
  "app/desk/books/exports/page.tsx",
  "app/desk/books/months/[month]/download/route.ts",
  "app/desk/books/months/[month]/page.tsx",
  "app/desk/books/page.tsx",
  "app/desk/books/reports/export/route.ts",
  "app/desk/books/reports/page.tsx",
  "app/desk/compliance/[id]/page.tsx",
  "app/desk/compliance/actions.ts",
  "app/desk/compliance/layout.tsx",
  "app/desk/compliance/page.tsx",
  "app/desk/paperwork/[id]/page.tsx",
  "app/desk/paperwork/page.tsx",
  "app/desk/paperwork/record-actions.ts",
  "app/desk/reports/export/route.ts",
  "app/desk/reports/page.tsx",
  "app/desk/sales-tax/audit-pack/export/route.ts",
  "app/desk/sales-tax/audit-pack/page.tsx",
  "app/desk/sales-tax/delivery-fees/page.tsx",
  "app/desk/sales-tax/layout.tsx",
  "app/desk/sales-tax/page.tsx",
  "app/desk/sales-tax/returns/[periodId]/amend/page.tsx",
  "app/desk/sales-tax/returns/[periodId]/csv/route.ts",
  "app/desk/sales-tax/returns/[periodId]/page.tsx",
  "app/desk/sales-tax/returns/calendar.ics/route.ts",
  "app/desk/sales-tax/returns/page.tsx",
  "app/desk/sales-tax/rules/page.tsx",
  "app/desk/settings/decisions/page.tsx",
];

// The desk shell itself and the two-factor enrollment page: without these the accountant
// cannot load any desk page, and a required second step would loop them out entirely.
const SETUP_GATE_ALLOWLIST = [
  "app/desk/layout.tsx",
  "app/desk/security/actions.ts",
  "app/desk/security/setup/page.tsx",
];

const DECISION_GUARD_ALLOWLIST = [
  "app/api/desk/decisions/answer/route.ts",
  "app/api/desk/decisions/attachments/[id]/route.ts",
  // The shared guard helper itself — it takes the role list as an argument; it admits nobody on its own.
  "app/api/desk/decisions/guard.ts",
];

// Every domain file whose actor gates may name the accountant.
const DOMAIN_ALLOWLIST = [
  "domains/account/index.ts",
  "domains/billing/setup-tax-planning.ts",
  "domains/books/adjustments.ts",
  "domains/books/bad-debt-policy.ts",
  "domains/books/cash/accounts.ts",
  "domains/books/cash/cash-readiness.ts",
  "domains/books/cash/desk.ts",
  "domains/books/cash/matches.ts",
  "domains/books/exports/index.ts",
  "domains/books/fixed-assets.ts",
  "domains/books/management.ts",
  "domains/books/month-review.ts",
  "domains/books/reports.ts",
  "domains/compliance/filings.ts",
  "domains/decisions/attachments.ts",
  "domains/decisions/index.ts",
  "domains/exceptions/index.ts",
  "domains/paperwork/records.ts",
  "domains/tax/filing-packet.ts",
  "domains/tax/policy-choices.ts",
  "domains/tax/retention.ts",
  "domains/tax/returns-view.ts",
  "domains/tax/setup.ts",
  "domains/tax/workspace-overview.ts",
];

// Areas that must never admit the role, whatever the sets above say (defense in depth, readable intent).
const NEVER_PREFIXES = [
  "app/desk/vault/",
  "domains/vault/",
  "app/desk/billing/money-actions.ts",
  "app/desk/billing/late-fee-actions.ts",
  "app/desk/billing/payment-link-actions.ts",
  "app/desk/billing/customer/",
  "app/desk/billing/held-payments/",
  "app/desk/billing/reconciliation/",
  "app/desk/billing/deposits/",
  "app/desk/sales-tax/returns/actions.ts",
  "app/desk/sales-tax/rules/actions.ts",
  "app/desk/sales-tax/setup/",
  "app/desk/sales-tax/exemptions/",
  "app/desk/sales-tax/taxability/",
  "app/desk/sales-tax/use-tax/",
  "app/desk/sales-tax/record-retention/",
  "app/desk/sales-tax/areas/",
  "app/desk/compliance/[id]/outputs/",
  "app/desk/compliance/facts/",
  "app/desk/books/budget/",
  "app/desk/books/closing/",
  "app/desk/books/setup/",
  "app/desk/customers/",
  "app/desk/settings/actions.ts",
  "domains/books/accountant-packet.ts",
];

describe("ACCT-1 accountant allowlist (static inventory)", () => {
  it("app surfaces admitting ACCOUNTANT are exactly the allowlist", () => {
    expect(filesMatching("app", APP_GATE)).toEqual(APP_ALLOWLIST);
  });

  it("shell and two-factor setup gates admitting ACCOUNTANT are exactly the allowlist", () => {
    expect(filesMatching("app", SETUP_GATE)).toEqual(SETUP_GATE_ALLOWLIST);
  });

  it("decision API routes admitting ACCOUNTANT are exactly the allowlist", () => {
    expect(filesMatching("app", DECISION_GUARD)).toEqual(DECISION_GUARD_ALLOWLIST);
  });

  it("domain gates naming ACCOUNTANT are exactly the allowlist", () => {
    expect(filesMatching("domains", DOMAIN_GATE)).toEqual(DOMAIN_ALLOWLIST);
  });

  it("no gated surface appears in a never-area", () => {
    const all = [
      ...filesMatching("app", APP_GATE),
      ...filesMatching("app", DECISION_GUARD),
      ...filesMatching("domains", DOMAIN_GATE),
    ];
    for (const file of all) {
      for (const prefix of NEVER_PREFIXES) {
        expect(file.startsWith(prefix), `${file} must never admit the accountant`).toBe(false);
      }
    }
  });

  it("function-level: only the named actions in books/actions.ts admit the role", () => {
    const source = readFileSync(join(ROOT, "app/desk/books/actions.ts"), "utf8");
    const chunks = source.split(/export async function (\w+)/);
    const admitting: string[] = [];
    for (let i = 1; i < chunks.length; i += 2) {
      if (/requireRole\([^)]*"ACCOUNTANT"/.test(chunks[i + 1]!)) admitting.push(chunks[i]!);
    }
    expect(admitting.sort()).toEqual([
      "closeMonthAction",
      "createAdjustmentAction",
      "lockReviewedMonthAction",
      "mapExportAccountAction",
      "reopenMonthAction",
    ]);
  });

  it("function-level: compliance actions admitting the role are prepare + mark-reviewed only", () => {
    const source = readFileSync(join(ROOT, "app/desk/compliance/actions.ts"), "utf8");
    const chunks = source.split(/export async function (\w+)/);
    const admitting: string[] = [];
    for (let i = 1; i < chunks.length; i += 2) {
      if (/requireRole\([^)]*"ACCOUNTANT"/.test(chunks[i + 1]!)) admitting.push(chunks[i]!);
    }
    expect(admitting.sort()).toEqual(["markReviewedAction", "prepareGuidedAction"]);
  });
});

describe("ACCT-1 accountant screen gate (pure)", () => {
  it("the screen set is exactly books, sales-tax and billing, plus the always-allowed basics", () => {
    expect([...ACCOUNTANT_SCREENS].sort()).toEqual(["billing", "books", "sales-tax"]);
  });

  it("allows the books/taxes/compliance/decisions/records paths and refuses everything else", () => {
    for (const ok of [
      "/desk/books",
      "/desk/books/months/2026-09",
      "/desk/sales-tax",
      "/desk/sales-tax/returns",
      "/desk/compliance",
      "/desk/compliance/abc123",
      "/desk/settings/decisions",
      "/desk/paperwork",
      "/desk/paperwork/rec-1",
      "/desk/billing",
      "/desk/reports",
      "/desk/account",
    ]) {
      expect(accountantAllowsPath(ok), ok).toBe(true);
    }
    for (const no of [
      "/desk/today", // operations inbox — not the accountant's surface
      "/desk/settings",
      "/desk/settings/decisions/form",
      "/desk/settings/decisions/import",
      "/desk/vault",
      "/desk/customers",
      "/desk/customers/c-1",
      "/desk/sales", // the sales screen is not the sales-tax screen
      "/desk/leads",
      "/desk/fleet",
      "/desk/expenses",
      "/desk/more",
      "/desk/automations",
    ]) {
      expect(accountantAllowsPath(no), no).toBe(false);
    }
  });

  it("paperwork sharing is the record's own flag, nothing else", () => {
    expect(accountantCanSeeRecord({ shareWithAccountant: true })).toBe(true);
    expect(accountantCanSeeRecord({ shareWithAccountant: false })).toBe(false);
  });

  it("the accountant is in the recommended second-step set", () => {
    expect(RECOMMENDED_TWO_FACTOR_ROLES).toContain("ACCOUNTANT");
    expect(roleRequiresTwoFactor("ACCOUNTANT", [...RECOMMENDED_TWO_FACTOR_ROLES])).toBe(true);
    // Since the Codex P1 fix the role is required under EVERY policy — the
    // stored setting can never switch the accountant's second step off.
    expect(roleRequiresTwoFactor("ACCOUNTANT", ["OWNER"])).toBe(true);
  });
});

describe("ACCT-1 access end dates (pure)", () => {
  it("next May 1 is the starting end date, as the end of that Denver day", () => {
    const fromJune = nextMayFirstEnd(new Date("2026-06-15T12:00:00Z"));
    expect(fromJune.toISOString()).toBe("2027-05-02T05:59:59.999Z"); // end of May 1, 2027 in Denver (MDT, UTC-6)
    const fromApril = nextMayFirstEnd(new Date("2026-04-15T12:00:00Z"));
    expect(fromApril.toISOString()).toBe("2026-05-02T05:59:59.999Z");
    const onMayFirst = nextMayFirstEnd(new Date("2026-05-01T12:00:00Z"));
    expect(onMayFirst.toISOString()).toBe("2027-05-02T05:59:59.999Z"); // May 1 itself already counts as this year's — next year
  });

  it("a picked date means the end of that Denver day", () => {
    expect(endOfDenverDayKey("2027-05-01").toISOString()).toBe("2027-05-02T05:59:59.999Z");
    // DST edges (Codex P2): spring forward 2026-03-08 (Denver day is 23 hours)
    // and fall back 2026-11-01 (25 hours) both end at the NEXT Denver midnight.
    expect(endOfDenverDayKey("2026-03-08").toISOString()).toBe("2026-03-09T05:59:59.999Z");
    expect(endOfDenverDayKey("2026-11-01").toISOString()).toBe("2026-11-02T06:59:59.999Z");
    expect(endOfDenverDayKey("2027-01-15").toISOString()).toBe("2027-01-16T06:59:59.999Z"); // MST, UTC-7
  });

  it("days-until and the To do thresholds: 14 days warns, past ends, six months reminds", () => {
    const ends = endOfDenverDayKey("2026-11-10");
    expect(daysUntilAccessEnds(ends, new Date("2026-10-27T12:00:00Z"))).toBe(14);
    expect(accessEndAttentionKind({ accessEndsOn: ends, createdAt: new Date("2026-01-01T00:00:00Z") }, new Date("2026-10-27T12:00:00Z"))).toBe("ending-soon");
    expect(accessEndAttentionKind({ accessEndsOn: ends, createdAt: new Date("2026-01-01T00:00:00Z") }, new Date("2026-10-20T12:00:00Z"))).toBeNull();
    expect(accessEndAttentionKind({ accessEndsOn: ends, createdAt: new Date("2026-01-01T00:00:00Z") }, new Date("2026-11-12T12:00:00Z"))).toBe("ended");
    expect(accessEndAttentionKind({ accessEndsOn: null, createdAt: new Date("2026-04-01T00:00:00Z") }, new Date("2026-10-27T12:00:00Z"))).toBe("open-ended-old");
    expect(accessEndAttentionKind({ accessEndsOn: null, createdAt: new Date("2026-09-01T00:00:00Z") }, new Date("2026-10-27T12:00:00Z"))).toBeNull();
  });
});
