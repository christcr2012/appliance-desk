#!/usr/bin/env node
// Runs one explicitly-assigned shard of the Playwright browser suite in CI.
// See e2e/shards.json for the assignment and docs/ARCHITECTURE.md (CI/CD)
// for why we don't use Playwright's built-in `--shard` (it balances by test
// count, which left one runner with ~4x the runtime of the others here).
//
//   node scripts/e2e-shard.mjs --check          validate the assignment only
//   node scripts/e2e-shard.mjs <group-name>      validate, then run that group
//   node scripts/e2e-shard.mjs all               validate, then run every group on one runner (what CI does)
//
// Validation fails if any e2e/*.spec.ts is missing from shards.json, listed
// twice, or listed but no longer exists — so adding a spec file without
// assigning it fails CI loudly instead of silently never running it.
//
// After a run, the slowest spec files are printed as GitHub Actions notices
// (readable from the Checks API even where the raw log and the HTML report
// artifact aren't reachable) so the groups can be rebalanced from real numbers.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const e2eDir = path.join(root, "e2e");
const resultsFile = path.join(root, "playwright-results.json");

const { groups } = JSON.parse(readFileSync(path.join(e2eDir, "shards.json"), "utf8"));
const onDisk = readdirSync(e2eDir).filter((f) => f.endsWith(".spec.ts")).sort();

function validate() {
  const seen = new Map();
  const problems = [];
  for (const [group, files] of Object.entries(groups)) {
    for (const file of files) {
      if (seen.has(file)) problems.push(`${file} is listed in both "${seen.get(file)}" and "${group}"`);
      seen.set(file, group);
      if (!existsSync(path.join(e2eDir, file))) problems.push(`${file} (group "${group}") does not exist in e2e/`);
    }
  }
  for (const file of onDisk) {
    if (!seen.has(file)) problems.push(`${file} is not assigned to any group in e2e/shards.json`);
  }
  if (problems.length) {
    console.error("e2e/shards.json is out of sync with e2e/*.spec.ts:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`e2e/shards.json OK: ${onDisk.length} spec files across ${Object.keys(groups).length} groups.`);
}

function reportDurations(group) {
  if (!existsSync(resultsFile)) return;
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  const perFile = new Map();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          perFile.set(spec.file, (perFile.get(spec.file) ?? 0) + (r.duration ?? 0));
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of results.suites ?? []) walk(s);
  const rows = [...perFile.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((n, [, ms]) => n + ms, 0);
  const summary = rows.map(([f, ms]) => `${path.basename(f)} ${(ms / 1000).toFixed(1)}s`).join(", ");
  // One notice per shard: total test-seconds (summed across workers), then files slowest-first.
  console.log(`::notice title=e2e shard "${group}" durations (${(total / 1000).toFixed(0)}s of test time)::${summary}`);
}

// Several specs call `test.skip(!fixtureExists, ...)` so they are harmless
// outside CI. In CI the fixtures always exist, so a skip means the setup broke;
// fail loudly instead of reporting a green run that tested less.
function checkNothingSkipped() {
  if (!existsSync(resultsFile)) {
    console.error("::error title=Skipped-test check::playwright-results.json was not written.");
    return false;
  }
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  const skipped = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status === "skipped") skipped.push(`${spec.file} > ${spec.title}`);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const s of results.suites ?? []) walk(s);
  if (!skipped.length) return true;
  console.error(`::error title=${skipped.length} browser test(s) skipped in CI::A CI fixture or saved login is missing.`);
  for (const s of skipped) console.error(`  - ${s}`);
  return false;
}

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/e2e-shard.mjs --check | all | <group-name>");
  process.exit(2);
}
validate();
if (arg === "--check") process.exit(0);
if (arg !== "all" && !groups[arg]) {
  console.error(`Unknown group "${arg}". Known: ${Object.keys(groups).join(", ")}`);
  process.exit(2);
}

// playwright.config.ts adds the JSON reporter in CI (writing resultsFile) so
// durations can be read back; everything else (list/github/html) is unchanged.
// Playwright treats each file argument as a regex matched anywhere in the
// path, so "accessibility.spec.ts" would also match
// "rental-address-accessibility.spec.ts". Anchor each one to exactly its file.
const files = arg === "all" ? Object.values(groups).flat() : groups[arg];
const patterns = files.map((f) => `/e2e/${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const result = spawnSync("npx", ["playwright", "test", ...patterns], { stdio: "inherit", cwd: root });
reportDurations(arg);
if ((result.status ?? 1) === 0 && process.env.CI && !checkNothingSkipped()) process.exit(1);
process.exit(result.status ?? 1);
