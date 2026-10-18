#!/usr/bin/env node
// One command that runs every cheap "paperwork" gate CI runs before the heavy tests, and says in plain words how to fix each
// failure. Run it after your last commit and before the single push:   npm run bundle:preflight
// It never changes files and never pushes. It does not replace `npm run check:quick` (typecheck, lint, secrets) or the tests.
import { execFileSync, spawnSync } from "node:child_process";

/** Each step: a name, the command, and what to do when it fails. Order is the order CI would hit them. */
export const STEPS = (base) => [
  { name: "clean tree", cmd: ["git", "diff", "--quiet"], hint: "Uncommitted changes exist. Commit them first: the gates below read committed files (git diff base...HEAD), not your working folder." },
  { name: "secret scan", cmd: ["node", "scripts/check-secrets.mjs"], hint: "A key-shaped string is in a file. Build it at run time (['sk_test_','x'].join('')) in tests; never commit a real secret." },
  { name: "work packet", cmd: ["node", "scripts/work-session.mjs", "check"], hint: "The execution packet or work-index.json points at a file, symbol or test that does not exist. Fix the path or anchor named in the message." },
  { name: "owner decision map", cmd: ["node", "scripts/check-owner-decisions.mjs"], hint: "activeExecution in docs/pr-cards/work-index.json changed. Update `activeExecutionMustRemain` in docs/owner-decisions/2026-10-13-implementation-map.json AND add the ID to allowedOrdered in scripts/check-owner-decisions.mjs (a deliberate, reviewed step)." },
  { name: "e2e shard list", cmd: ["node", "scripts/e2e-shard.mjs", "--check"], hint: "Every e2e/*.spec.ts must be listed once in e2e/shards.json. A spec that skips on purpose must also be in INTENTIONALLY_SKIPPED in scripts/e2e-shard.mjs." },
  { name: "launch ledger current", warnOnly: true, cmd: ["node", "scripts/launch-ledger.mjs", "--check"], hint: "You changed PLAN.md, GO-LIVE-CHECKLIST.md, a scenario list or the review dispositions. Run `npm run ledger` and commit docs/LAUNCH-LEDGER.md." },
  { name: "docs describe the change", cmd: ["node", "scripts/check-docs-updated.mjs", base, "HEAD"], hint: "App code (src/ or prisma/) changed, so docs/STATUS.md AND a docs/pr-cards/*.md or work-index.json file must change in the same PR." },
  { name: "scorecard", cmd: ["node", "scripts/pr-progress.mjs", "--check", "--require-changed", "--base", base, "--ref", "HEAD"], hint: "Edit docs/pr-cards/current-pr-scorecard.json. kind 'implementation' needs completed slices with one evidence line per acceptance item AND real changes under src/ or prisma/; 'maintenance' needs no src/ changes and no slices; 'risk_remediation' needs 3+ riskEvidence lines and a workloadException." },
];

export function cardBundleCheck(card, plannedAt, report) {
  if (!card) return null;
  const cmd = ["node", "scripts/bundle-plan.mjs", "--card", card];
  if (plannedAt && report) cmd.push("--planned-at", plannedAt, "--report", report);
  return { name: "frozen bundle plan", cmd, hint: "The card's bundle-plan block is missing or the planning commit (docs-only, made BEFORE coding) is not the one you passed. Pass the full 40-character planning SHA and a complete --report /tmp/delivery.json." };
}

export function findPlaceholders(text) {
  return text.split("\n").map((line, i) => ({ line: i + 1, text: line })).filter((l) => /\b(TODO|FILL IN|TBD)\b/.test(l.text));
}

export function summarize(results) {
  const warned = results.filter((r) => !r.ok && r.warnOnly);
  const failed = results.filter((r) => !r.ok && !r.warnOnly);
  const warnings = warned.map((r) => `  - WARNING ${r.name}: ${r.hint}`);
  return failed.length
    ? [`${failed.length} of ${results.length} paperwork gates FAILED:`, ...failed.map((r) => `  - ${r.name}: ${r.hint}`)].join("\n")
    : [`All required paperwork gates passed. Next: npm run check:quick, your focused tests, then ONE push.`, ...warnings].join("\n");
}

export function run(steps, exec = (cmd) => spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" })) {
  return steps.map((step) => {
    const result = exec(step.cmd);
    return { ...step, ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-6).join("\n") };
  });
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const base = get("--base") ?? execFileSync("git", ["merge-base", "origin/main", "HEAD"], { encoding: "utf8" }).trim();
  const steps = STEPS(base);
  if (get("--planned-at") && !get("--report")) { console.error("A frozen delivery needs both --planned-at FULL_SHA and --report PATH. See docs/AGENT-QUICKSTART.md."); process.exitCode = 1; return; }
  const extra = cardBundleCheck(get("--card"), get("--planned-at"), get("--report"));
  if (extra) steps.push(extra);
  const results = run(steps);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : r.warnOnly ? "WARN" : "FAIL"}  ${r.name}`);
    if (!r.ok && r.output) console.log(r.output.split("\n").map((l) => `        ${l}`).join("\n"));
  }
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", "docs/pr-cards"], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const file of files.filter((f) => /\.(md|json)$/.test(f))) {
    const found = findPlaceholders(execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" }));
    if (found.length) { results.push({ name: `placeholders in ${file}`, ok: false, hint: `Replace every TODO/TBD (first at line ${found[0].line}) with real content.` }); console.log(`FAIL  placeholders in ${file}`); }
  }
  console.log(`\n${summarize(results)}`);
  process.exit(results.every((r) => r.ok || r.warnOnly) ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) main();
