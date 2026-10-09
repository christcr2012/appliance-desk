#!/usr/bin/env node
// Targeted local publication checks. Full exact-head CI remains the merge gate.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { codeFingerprint, hasPassed, markPassed, recordName } from './check-cache.mjs';

export function parse(args) {
  const result = { base: 'origin/main', unit: [], db: [], browser: [], related: [], plan: false, inside: false, quick: false, fresh: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--plan' || flag === '--inside' || flag === '--quick' || flag === '--fresh') { result[flag.slice(2)] = true; continue; }
    if (!['--base', '--unit', '--db', '--browser', '--related'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error('Usage: npm run preflight -- [--quick] [--fresh] [--base ref] [--unit tests/file.test.ts] [--db tests/file.test.ts] [--browser e2e/file.spec.ts] [--plan]. Repeat selectors for more files.');
    const value = args[++i];
    if (flag === '--base') { if (value.startsWith('-')) throw new Error('Invalid base'); result.base = value; continue; }
    const kind = flag.slice(2);
    const valid = kind === 'browser' ? /^e2e\/[\w/-]+\.spec\.ts$/ : kind === 'related' ? /^src\/[\w/.()[\]@-]+\.tsx?$/ : /^tests\/[\w/-]+\.test\.[cm]?[jt]sx?$/;
    if (!valid.test(value) || value.includes('..')) throw new Error(`Invalid ${kind} selector: ${value}`);
    result[kind].push(value);
  }
  return result;
}

// Known CI consumers of shared contracts. Add to this narrow map when a
// regression reveals a missed dependency; preserve GitHub's complete CI suite.
export function adjacentRegressions(changed) {
  const paths = [
    [/^src\/(?:domains\/system-issues\/|app\/desk\/(?:today|automations)\/)/,
      ['tests/today-role-access.test.ts', 'tests/desk-navigation.test.ts']],
    [/^src\/(?:lib\/desk-navigation|components\/desk\/.*navigation)/,
      ['tests/desk-navigation.test.ts']],
    [/^src\/domains\/backup\//, ['tests/backup-restore-integration.test.ts', 'tests/backup.test.ts']],
    [/^prisma\/schema\.prisma$/, ['tests/schema-health.test.ts', 'tests/backup.test.ts']],
    [/^src\/app\/.*(?:page|layout)\.[jt]sx?$/, ['tests/accessibility-route-inventory.test.ts']],
  ];
  return [...new Set(paths.flatMap(([re, specs]) =>
    changed.some(file => re.test(file)) ? specs : []))];
}

// Changed source files whose importing tests Vitest finds by its import graph. They run inside the
// disposable database (some importing tests need one), catching stale fakes, registries and consumers.
export function relatedSources(changed, exists = existsSync) {
  return changed.filter(p => /^src\/[\w/.()[\]@-]+\.tsx?$/.test(p) && !p.includes('..') && exists(p));
}

export function commands(options, changed) {
  const application = changed.some(p => !p.startsWith('docs/') && !p.endsWith('.md'));
  const behavior = changed.some(p => /^(src|prisma|tests|e2e)\//.test(p));
  const screen = changed.some(p => /^src\/components\//.test(p) || /^src\/app\/.*\.tsx$/.test(p) || /^src\/app\/(?:.*\/)?(page|layout)\.[jt]s$/.test(p) || /^src\/.*\.css$/.test(p) || /^e2e\/.+\.spec\.ts$/.test(p));
  if (options.quick) {
    // The automatic pre-push gate (.githooks/pre-push): cheap checks that caught most red CI runs.
    const quick = [['node', 'scripts/check-secrets.mjs'], ['node', 'scripts/check-migrations.mjs'], ['node', 'scripts/e2e-shard.mjs', '--check'], ['node', 'scripts/check-route-inventory.mjs']];
    if (application) quick.push(['npm', 'run', 'typecheck'], ['npm', 'run', 'lint']);
    return quick;
  }
  if (!options.inside && behavior && !options.unit.length && !options.db.length && !options.browser.length)
    throw new Error('Code changed: select its meaningful unit, database or browser regressions. --plan does not count as verification.');
  if (!options.inside && screen && !options.browser.length)
    throw new Error('Screen/spec changed: select affected --browser specs before publishing. If local setup is blocked, record the exact blocker and use required CI; do not claim local browser proof.');
  const list = options.inside ? [] : [ ['node', 'scripts/check-secrets.mjs'], ['node', 'scripts/check-migrations.mjs'], ['node', 'scripts/e2e-shard.mjs', '--check'], ['node', 'scripts/check-route-inventory.mjs'], ['node', '--test', 'scripts/preflight.test.mjs'] ];
  if (!options.inside && application) list.push(['npm', 'run', 'typecheck'], ['npm', 'run', 'lint']);
  const adjacent = options.inside ? [] : adjacentRegressions(changed)
    .filter(file => !options.unit.includes(file) && !options.db.includes(file) && existsSync(file));
  if (!options.inside && (options.db.length || options.browser.length || adjacent.length)) {
    const selections = [...options.unit.map(p => ['--unit', p]), ...[...options.db, ...adjacent].map(p => ['--db', p]), ...options.browser.map(p => ['--browser', p]), ...relatedSources(changed).map(p => ['--related', p])].flat();
    list.push(['bash', 'scripts/local-postgres-test.sh', '--checks', ...(options.fresh ? ['--fresh'] : []), ...selections]);
  } else {
    if (options.related.length) list.push(['npx', '--no-install', 'vitest', 'related', '--run', '--passWithNoTests', ...options.related]);
    const units = [...new Set([...options.unit, ...options.db, ...adjacent])];
    if (units.length) {
      list.push(['npx', '--no-install', 'vitest', 'run', ...units, '--reporter=default', '--reporter=json', '--outputFile.json=vitest-results.json']);
      list.push(['node', 'scripts/check-no-skipped-tests.mjs', 'vitest-results.json']);
    }
    if (options.browser.length) list.push(['node', 'scripts/local-browser-test.mjs', ...options.browser]);
  }
  return list;
}

// A test run and the skipped-test check that reads its report pass or fail together, so they share one record.
export function groupSteps(steps) {
  const groups = [];
  for (const step of steps) {
    if (step[1] === 'scripts/check-no-skipped-tests.mjs' && groups.length) groups.at(-1).push(step);
    else groups.push([step]);
  }
  return groups;
}

// Settings that change what a browser check proves (stand-in font or browser) are part of its record.
export function recordExtra(env = process.env) {
  return [env.LOCAL_TEST_FONT ? 'stand-in-font' : '', env.LOCAL_TEST_CHROMIUM ? 'stand-in-chromium' : ''].join('|');
}

export function run(command, executor = spawnSync, fresh = process.argv.includes('--fresh')) {
  const env = { ...process.env, CI: 'true', ...(fresh ? { APPLIANCE_DESK_FRESH: 'true' } : {}) };
  const result = executor(command[0], command.slice(1), { stdio: 'inherit', timeout: 600_000, env });
  if (result.error || result.signal || result.status !== 0)
    throw new Error(`${command[0]} ${command.slice(1).join(' ')} failed${result.error ? `: ${result.error.message}` : ` (${result.signal ?? result.status})`}. No passing preflight evidence.`);
}

export function verifyBrowserReport(report) {
  let tests = 0;
  const skipped = [];
  const walk = suite => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      tests++;
      if (test.status === 'skipped') skipped.push(`${spec.file} > ${spec.title}`);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  if (!Array.isArray(report.suites)) throw new Error('Invalid browser result report.');
  for (const suite of report.suites) walk(suite);
  if (!tests || skipped.length) throw new Error(`Browser proof incomplete: ${tests} tests, ${skipped.length} skipped. ${skipped.join('; ')}`);
}

function main() {
  const options = parse(process.argv.slice(2));
  if (options.inside) {
    const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
    if (process.env.CI !== 'true' || url.hostname !== 'localhost' || url.pathname !== '/appliance_desk_test')
      throw new Error('Internal checks require the disposable localhost appliance_desk_test database.');
  }
  for (const file of [...options.unit, ...options.db, ...options.browser, ...options.related]) if (!existsSync(file)) throw new Error(`Missing selected regression: ${file}`);
  // Compare to the actual target, plus tracked edits and newly created files.
  const changed = options.inside ? [] : [...new Set([
    ...execFileSync('git', ['diff', '--name-only', `${options.base}...HEAD`], { encoding: 'utf8' }).split('\n'),
    ...execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n'),
  ].filter(Boolean))];
  const steps = commands(options, changed);
  // Each check records that it passed for this exact code (scripts/check-cache.mjs): the pre-push gate then skips
  // what preflight just ran, and a run cut off by an expired sandbox session resumes where it stopped.
  const fingerprint = options.plan ? '' : codeFingerprint();
  for (const group of groupSteps(steps)) {
    const name = recordName(group, fingerprint, recordExtra());
    if (!options.plan && !options.fresh && hasPassed(name)) {
      console.log(`✓ already passed for this exact code: ${group.map(step => step.join(' ')).join(' && ')}`);
      continue;
    }
    for (const step of group) { console.log(`> ${step.join(' ')}`); if (!options.plan) run(step); }
    if (!options.plan) markPassed(name, group.map(step => step.join(' ')).join(' && '));
  }
  console.log(options.plan ? 'Plan only: no checks ran.' : 'Selected preflight passed. Any subsequent code/base change requires fresh affected checks; full exact-head CI is still required.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
