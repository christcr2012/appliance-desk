#!/usr/bin/env node
// Fails CI when a unit/integration test was skipped. Many real-Postgres tests
// use `describe.skipIf(!enabled)` so they never touch a non-throwaway database;
// that guard is right locally, but in CI a broken environment variable would
// turn hundreds of real tests into silent skips while the run stays green.
//
//   node scripts/check-no-skipped-tests.mjs <vitest-json-report>
//
// The report comes from `vitest run --reporter=default --reporter=json
// --outputFile.json=<file>`. The only test allowed to skip in the main unit
// job is a dedicated performance test that runs in its own workflow
// (.github/workflows/perf.yml, BATCH_E_PERF=true). Pure perf guard tests still
// run in normal CI and therefore are not allow-listed here.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ALLOWED_TO_SKIP = new Set([
  "tests/perf/batch-e-large-lists.test.ts",
  "tests/perf/large-account.test.ts",
  "tests/perf/large-invoices.test.ts",
]);

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error(`::error title=Skipped-test check::No vitest JSON report at "${file}". The test step did not write one.`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(file, "utf8"));
const root = process.cwd();
const skipped = [];
for (const result of report.testResults ?? []) {
  const rel = path.relative(root, result.name).split(path.sep).join("/");
  if (ALLOWED_TO_SKIP.has(rel)) continue;
  for (const t of result.assertionResults ?? []) {
    if (t.status === "skipped" || t.status === "pending" || t.status === "todo") {
      skipped.push(`${rel} > ${t.fullName ?? t.title}`);
    }
  }
}

if (skipped.length) {
  console.error(
    `::error title=${skipped.length} test(s) skipped in CI::Every test must run in CI. ` +
      "A skip here usually means a CI environment variable or fixture is missing.",
  );
  for (const s of skipped) console.error(`  - ${s}`);
  process.exit(1);
}
const total = (report.numTotalTests ?? 0) - (report.numPendingTests ?? 0) - (report.numTodoTests ?? 0);
console.log(`Skipped-test check OK: ${total} tests ran, none skipped outside the allowed list.`);
