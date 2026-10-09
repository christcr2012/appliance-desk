#!/usr/bin/env node
// Targeted local publication checks. Full exact-head CI remains the merge gate.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parse(args) {
  const result = { base: 'origin/main', unit: [], db: [], browser: [], plan: false, inside: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--plan' || flag === '--inside') { result[flag.slice(2)] = true; continue; }
    if (!['--base', '--unit', '--db', '--browser'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error('Usage: npm run preflight -- [--base ref] [--unit tests/file.test.ts] [--db tests/file.test.ts] [--browser e2e/file.spec.ts] [--plan]. Repeat selectors for more files.');
    const value = args[++i];
    if (flag === '--base') { if (value.startsWith('-')) throw new Error('Invalid base'); result.base = value; continue; }
    const kind = flag.slice(2);
    const valid = kind === 'browser' ? /^e2e\/[\w/-]+\.spec\.ts$/ : /^tests\/[\w/-]+\.test\.[cm]?[jt]sx?$/;
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

export function commands(options, changed) {
  const application = changed.some(p => !p.startsWith('docs/') && !p.endsWith('.md'));
  const behavior = changed.some(p => /^(src|prisma|tests|e2e)\//.test(p));
  const screen = changed.some(p => /^src\/components\//.test(p) || /^src\/app\/.*\.tsx$/.test(p) || /^src\/app\/(?:.*\/)?(page|layout)\.[jt]s$/.test(p) || /^src\/.*\.css$/.test(p) || /^e2e\/.+\.spec\.ts$/.test(p));
  if (!options.inside && behavior && !options.unit.length && !options.db.length && !options.browser.length)
    throw new Error('Code changed: select its meaningful unit, database or browser regressions. --plan does not count as verification.');
  if (!options.inside && screen && !options.browser.length)
    throw new Error('Screen/spec changed: select affected --browser specs before publishing. If local setup is blocked, record the exact blocker and use required CI; do not claim local browser proof.');
  const list = options.inside ? [] : [ ['node', 'scripts/check-secrets.mjs'], ['node', 'scripts/check-migrations.mjs'], ['node', 'scripts/e2e-shard.mjs', '--check'], ['node', '--test', 'scripts/preflight.test.mjs'] ];
  if (!options.inside && application) list.push(['npm', 'run', 'typecheck'], ['npm', 'run', 'lint']);
  const adjacent = options.inside ? [] : adjacentRegressions(changed)
    .filter(file => !options.unit.includes(file) && !options.db.includes(file) && existsSync(file));
  if (!options.inside && (options.db.length || options.browser.length || adjacent.length)) {
    const selections = [...options.unit.map(p => ['--unit', p]), ...[...options.db, ...adjacent].map(p => ['--db', p]), ...options.browser.map(p => ['--browser', p])].flat();
    list.push(['bash', 'scripts/local-postgres-test.sh', '--checks', ...selections]);
  } else {
    const units = [...new Set([...options.unit, ...options.db, ...adjacent])];
    if (units.length) {
      list.push(['npx', '--no-install', 'vitest', 'run', ...units, '--reporter=default', '--reporter=json', '--outputFile.json=vitest-results.json']);
      list.push(['node', 'scripts/check-no-skipped-tests.mjs', 'vitest-results.json']);
    }
    if (options.browser.length) list.push(['node', 'scripts/local-browser-test.mjs', ...options.browser]);
  }
  return list;
}

export function run(command, executor = spawnSync) {
  const result = executor(command[0], command.slice(1), { stdio: 'inherit', timeout: 600_000, env: { ...process.env, CI: 'true' } });
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
  for (const file of [...options.unit, ...options.db, ...options.browser]) if (!existsSync(file)) throw new Error(`Missing selected regression: ${file}`);
  // Compare to the actual target, plus tracked edits and newly created files.
  const changed = options.inside ? [] : [...new Set([
    ...execFileSync('git', ['diff', '--name-only', `${options.base}...HEAD`], { encoding: 'utf8' }).split('\n'),
    ...execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n'),
  ].filter(Boolean))];
  const steps = commands(options, changed);
  for (const step of steps) { console.log(`> ${step.join(' ')}`); if (!options.plan) run(step); }
  console.log(options.plan ? 'Plan only: no checks ran.' : 'Selected preflight passed. Any subsequent code/base change requires fresh affected checks; full exact-head CI is still required.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
