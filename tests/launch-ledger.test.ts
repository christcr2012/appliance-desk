// F2-D (WU-F8): the launch ledger tells the truth — no evidence means OPEN, owner gates are decisions for Chris,
// the authorization line is blank, and the committed ledger has the same sections as a fresh generation.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLedger, parseChecklist, renderItem, SCENARIOS } from "../scripts/launch-ledger.mjs";

describe("launch ledger", () => {
  it("renders an item without evidence as OPEN, even when it is ticked", () => {
    expect(renderItem({ text: "Prices reviewed", checked: false })).toMatch(/^- OPEN: /);
    expect(renderItem({ text: "Done but nothing named", checked: true, evidence: "" })).toMatch(/^- OPEN \(ticked/);
    expect(renderItem({ text: "Done with proof tests/x.test.ts", checked: true, evidence: "tests/x.test.ts" })).toMatch(/^- PROVEN: /);
  });
  it("only treats a ticked line as evidence when it names a file, test, PR or CI run", () => {
    const items = parseChecklist("## A\n- [x] Fixed with tests/a.test.ts\n- [x] Looks fine to me\n- [ ] Not done tests/b.test.ts\n| [x] | Row (#123) |\n");
    expect(items.map((i: { evidence: string }) => Boolean(i.evidence))).toEqual([true, false, false, true]);
  });
  it("renders owner gates as decisions for Chris, never as proven", () => {
    expect(renderItem({ text: "Live Stripe key put in production", checked: true, evidence: "x", ownerGate: true })).toMatch(/^- DECISION \(Chris\): /);
    const ledger = buildLedger();
    expect(ledger).toContain("## Go-live switches and checks waiting on Chris");
    expect(ledger).not.toMatch(/PROVEN: .*Live secret key put in production/);
    expect(ledger).toMatch(/DECISION \(Chris\): .*Stripe/);
  });
  it("ends with the explicit owner gates and a blank authorization line only Chris fills in", () => {
    const ledger = buildLedger() as string;
    expect(ledger).toContain("## Human / owner gates that stay explicit");
    expect(ledger).toMatch(/live Stripe\/Twilio\/Resend\/Google activation/);
    expect(ledger.trimEnd().endsWith("Owner authorization: ____")).toBe(true);
  });
  it("lists every integrated scenario with a file that exists, and marks a missing file OPEN", () => {
    expect(SCENARIOS).toHaveLength(17);
    const missing = buildLedger(undefined, () => false) as string;
    expect(missing).toContain("OPEN (file missing)");
    expect(buildLedger() as string).not.toContain("OPEN (file missing)");
  });
  it("can always be generated from the committed sources, and the committed ledger has the same shape", () => {
    // Deliberately NOT an exact-match check: other people's unrelated pull requests change PLAN.md and would fail here.
    // `npm run bundle:preflight` warns when the committed ledger is out of date; regenerate with `npm run ledger`.
    const fresh = buildLedger() as string;
    const committed = readFileSync("docs/LAUNCH-LEDGER.md", "utf8");
    const headings = (text: string) => text.split("\n").filter((l) => l.startsWith("## "));
    expect(headings(committed)).toEqual(headings(fresh));
    expect(committed.trimEnd().endsWith("Owner authorization: ____")).toBe(true);
  });
});

describe("rollback runbook", () => {
  const text = readFileSync("docs/runbooks/ROLLBACK.md", "utf8");
  it("never suggests a destructive database rollback and names the safe paths", () => {
    expect(text).toMatch(/never the database/i);
    expect(text).toMatch(/additive/i);
    expect(text).toContain("Instant Rollback");
    expect(text).toContain("Drill");
    expect(text).toMatch(/Last drilled: \d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\bDROP (TABLE|COLUMN)\b|--force|--no-verify/i);
  });
});
