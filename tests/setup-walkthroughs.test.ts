import { describe, expect, it } from "vitest";
import {
  IMPLEMENTED_CHECK_TYPES,
  SETUP_ENV_ALLOWLIST,
  WALKTHROUGHS,
  daysUntilMonthDay,
  describeCheck,
  getWalkthrough,
  suggestNextWalkthrough,
  type WalkthroughStanding,
} from "@/domains/setup/walkthroughs";
import { PAPERWORK_TEMPLATES } from "@/domains/paperwork/templates";

// SETUP-1 walkthrough data (spec §10): every link https, every record
// templateKey exists, every check implemented — plus the suggestion order.

const TEMPLATE_KEYS = new Set(PAPERWORK_TEMPLATES.map((t) => t.key));

describe("walkthrough data", () => {
  it("has all 16 spec walkthroughs, in order", () => {
    expect(WALKTHROUGHS.map((w) => w.key)).toEqual([
      "business-basics",
      "ein",
      "bank-and-stripe",
      "colorado-sales-tax",
      "greeley-license",
      "weld-assessor",
      "irs-accounts",
      "iris-tcc",
      "insurance",
      "vehicle",
      "email-domain",
      "texting",
      "encryption-keys",
      "your-cpa",
      "write-offs",
      "backups",
    ]);
  });

  it("uses unique walkthrough and step keys", () => {
    const walkthroughKeys = WALKTHROUGHS.map((w) => w.key);
    expect(new Set(walkthroughKeys).size).toBe(walkthroughKeys.length);
    for (const w of WALKTHROUGHS) {
      const stepKeys = w.steps.map((s) => s.key);
      expect(new Set(stepKeys).size, w.key).toBe(stepKeys.length);
      expect(w.steps.length, w.key).toBeGreaterThan(0);
    }
  });

  it("only links out over https", () => {
    for (const w of WALKTHROUGHS) {
      for (const s of w.steps) {
        if (s.link) expect(s.link.href, `${w.key}/${s.key}`).toMatch(/^https:\/\/[^\s]+$/);
      }
    }
  });

  it("only fills records whose starter template exists", () => {
    for (const w of WALKTHROUGHS) {
      for (const s of w.steps) {
        if (s.record) {
          expect(TEMPLATE_KEYS.has(s.record.templateKey), `${w.key}/${s.key} → ${s.record.templateKey}`).toBe(true);
          for (const f of s.record.fields) expect(["number", "file"]).toContain(f);
        }
        if (
          s.check &&
          (s.check.type === "RECORD_EXISTS" || s.check.type === "RECORD_HAS_NUMBER" || s.check.type === "RECORD_HAS_FILE")
        ) {
          expect(TEMPLATE_KEYS.has(s.check.templateKey), `${w.key}/${s.key} check`).toBe(true);
        }
      }
    }
  });

  it("only names implemented checks and allowlisted env keys", () => {
    for (const w of WALKTHROUGHS) {
      for (const s of w.steps) {
        if (!s.check) continue;
        expect(IMPLEMENTED_CHECK_TYPES, `${w.key}/${s.key}`).toContain(s.check.type);
        if (s.check.type === "ENV_PRESENT") {
          expect(SETUP_ENV_ALLOWLIST as readonly string[]).toContain(s.check.env);
        }
        if (s.check.type === "ENV_ALL_PRESENT") {
          for (const name of s.check.envs) {
            expect(SETUP_ENV_ALLOWLIST as readonly string[]).toContain(name);
          }
        }
        // describeCheck must cover it too (the screen prints this line).
        expect(describeCheck(s.check).length).toBeGreaterThan(10);
      }
    }
  });

  it("carries why, needs and an estimate on every walkthrough", () => {
    for (const w of WALKTHROUGHS) {
      expect(w.why.length, w.key).toBeGreaterThan(20);
      expect(w.needs.length, w.key).toBeGreaterThan(0);
      expect(w.unlocks.length, w.key).toBeGreaterThan(0);
      expect(w.estimatedMinutes, w.key).toBeGreaterThan(0);
    }
    expect(getWalkthrough("iris-tcc")?.neededBy).toEqual({
      monthDay: "01-31",
      label: expect.any(String),
    });
  });
});

describe("daysUntilMonthDay", () => {
  it("counts to this year's date, then next year's", () => {
    expect(daysUntilMonthDay("2026-10-27", "01-31")).toBe(96);
    expect(daysUntilMonthDay("2027-01-31", "01-31")).toBe(0);
    expect(daysUntilMonthDay("2027-02-01", "01-31")).toBe(364);
    expect(daysUntilMonthDay("2026-12-31", "01-01")).toBe(1);
  });
});

describe("suggestNextWalkthrough", () => {
  const standings = (over: Partial<Record<string, Partial<WalkthroughStanding>>> = {}): WalkthroughStanding[] =>
    WALKTHROUGHS.map((w) => ({
      key: w.key,
      complete: false,
      dismissed: false,
      ...(over[w.key] ?? {}),
    }));

  it("starts at the top of the list", () => {
    expect(suggestNextWalkthrough(standings(), new Date("2026-06-15T12:00:00Z"))?.key).toBe("business-basics");
  });

  it("suggests the IRIS TCC ahead of order when January 31 is within 120 days", () => {
    // Mid-November: business basics still open, but the TCC unlocks soonest.
    expect(suggestNextWalkthrough(standings(), new Date("2026-11-15T12:00:00Z"))?.key).toBe("iris-tcc");
  });

  it("does not pull the TCC forward in spring", () => {
    expect(suggestNextWalkthrough(standings(), new Date("2026-04-15T12:00:00Z"))?.key).toBe("business-basics");
  });

  it("skips complete and dismissed walkthroughs, and returns null at the end", () => {
    const over: Partial<Record<string, Partial<WalkthroughStanding>>> = {
      "business-basics": { complete: true },
      ein: { dismissed: true },
    };
    expect(suggestNextWalkthrough(standings(over), new Date("2026-06-15T12:00:00Z"))?.key).toBe("bank-and-stripe");
    const all: Partial<Record<string, Partial<WalkthroughStanding>>> = {};
    for (const w of WALKTHROUGHS) all[w.key] = { complete: true };
    expect(suggestNextWalkthrough(standings(all), new Date("2026-06-15T12:00:00Z"))).toBeNull();
  });
});
