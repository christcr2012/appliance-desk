import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, commands, adjacentRegressions, relatedSources, run, verifyBrowserReport, groupSteps, recordExtra } from './preflight.mjs';

test('documentation avoids app work but preserves static repository checks', () => {
  const steps = commands(parse([]), ['docs/STATUS.md']);
  assert.equal(steps.length, 5);
  assert.ok(steps.some(s => s.includes('scripts/check-secrets.mjs')));
  assert.ok(steps.some(s => s.includes('scripts/check-route-inventory.mjs')));
  assert.ok(!steps.some(s => s[0] === 'npm'));
});
test('code without selected behavior tests fails before any command', () => {
  assert.throws(() => commands(parse([]), ['src/domains/tax/index.ts']), /select its meaningful/);
});
test('UI publication requires affected browser specs', () => {
  assert.throws(() => commands(parse(['--unit', 'tests/tax.test.ts']), ['src/app/desk/sales-tax/page.tsx']), /affected --browser/);
  assert.throws(() => commands(parse(['--unit', 'tests/tax.test.ts']), ['src/app/page.tsx']), /affected --browser/);
});
test('unit, database and browser checks share one disposable cluster', () => {
  const steps = commands(parse(['--unit', 'tests/tax.test.ts', '--db', 'tests/tax-integration.test.ts', '--browser', 'e2e/sales-tax.spec.ts']), ['src/app/desk/sales-tax/page.tsx']);
  assert.equal(steps.filter(s => s[0] === 'bash').length, 1);
  const child = parse(['--inside', ...steps.at(-1).slice(3)]);
  const checks = commands(child, []);
  const vitestRun = checks.find(s => s[3] === 'run');
  assert.ok(vitestRun.includes('tests/tax-integration.test.ts'));
  assert.ok(vitestRun.includes('tests/tax.test.ts'));
  assert.deepEqual(checks.at(-1), ['node', 'scripts/local-browser-test.mjs', 'e2e/sales-tax.spec.ts']);
});
test('invalid selectors and option injection are rejected', () => {
  for (const args of [['--unit', '../real.ts'], ['--browser', '--all'], ['--unit', 'tests/../real.test.ts'], ['--unknown']])
    assert.throws(() => parse(args));
});
test('failed, timed out and signalled commands cannot produce green proof', () => {
  for (const result of [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { error: new Error('timeout') }])
    assert.throws(() => run(['node', 'check.mjs'], () => result), /No passing preflight/);
  assert.doesNotThrow(() => run(['node', 'check.mjs'], () => ({ status: 0 })));
});
test('actual child-process failures propagate instead of being masked by output handling', () => {
  assert.throws(() => run([process.execPath, '-e', 'process.exit(17)']), /failed \(17\)/);
});
test('missing, empty and skipped browser results fail closed', () => {
  assert.throws(() => verifyBrowserReport({}), /Invalid/);
  assert.throws(() => verifyBrowserReport({ suites: [] }), /incomplete/);
  const report = { suites: [{ suites: [{ specs: [{ file: 'role.spec.ts', title: 'ADMIN', tests: [{ status: 'skipped' }] }] }] }] };
  assert.throws(() => verifyBrowserReport(report), /1 skipped/);
  report.suites[0].suites[0].specs[0].tests[0].status = 'expected';
  assert.doesNotThrow(() => verifyBrowserReport(report));
});

test('test/CI drift: changed diagnostics require existing Today and navigation regressions', () => {
  assert.deepEqual(adjacentRegressions(['src/domains/system-issues/actions.ts']), [
    'tests/today-role-access.test.ts', 'tests/desk-navigation.test.ts'
  ]);
  const steps = commands(parse(['--db', 'tests/system-issue-actions-integration.test.ts']), [
    'src/domains/system-issues/actions.ts'
  ]);
  assert.ok(steps.some(s => s.includes('tests/today-role-access.test.ts')));
  assert.ok(steps.some(s => s.includes('tests/desk-navigation.test.ts')));
});
test('test/CI drift: route, schema and backup changes retain affected legacy tests', () => {
  assert.ok(adjacentRegressions(['src/app/desk/test/page.tsx']).includes('tests/accessibility-route-inventory.test.ts'));
  assert.ok(adjacentRegressions(['src/domains/backup/manifest.ts']).includes('tests/backup-restore-integration.test.ts'));
  assert.ok(adjacentRegressions(['prisma/schema.prisma']).includes('tests/backup.test.ts'));
  assert.deepEqual(adjacentRegressions(['docs/PLAN.md']), []);
});
test('quick pre-push gate runs cheap checks without requiring selectors', () => {
  const steps = commands(parse(['--quick']), ['src/domains/tax/engine.ts']);
  assert.ok(steps.some(s => s.join(' ') === 'npm run typecheck'));
  assert.ok(steps.some(s => s.join(' ') === 'npm run lint'));
  assert.ok(steps.some(s => s.includes('scripts/check-secrets.mjs')));
  assert.ok(!steps.some(s => s[0] === 'bash'));
});
test('quick gate on documentation skips application checks', () => {
  const steps = commands(parse(['--quick']), ['docs/STATUS.md']);
  assert.ok(!steps.some(s => s[0] === 'npm' || s.includes('related')));
});
test('related sources: changed, existing source files only', () => {
  assert.deepEqual(relatedSources(['src/a.ts', 'src/gone.ts', 'docs/x.md', 'prisma/schema.prisma', 'src/app/desk/[id]/page.tsx'],
    p => p !== 'src/gone.ts'), ['src/a.ts', 'src/app/desk/[id]/page.tsx']);
});
test('related tests run inside the disposable database, never in the quick gate', () => {
  assert.ok(!commands(parse(['--quick']), ['src/domains/tax/engine.ts']).some(s => s.includes('related')));
  const outer = commands(parse(['--db', 'tests/tax-integration.test.ts']), ['src/domains/tax/engine.ts']);
  const bash = outer.find(s => s[0] === 'bash');
  assert.ok(bash.join(' ').includes('--related src/domains/tax/engine.ts'));
  const inside = commands(parse(['--inside', '--related', 'src/domains/tax/engine.ts', '--db', 'tests/tax-integration.test.ts']), []);
  assert.deepEqual(inside[0], ['npx', '--no-install', 'vitest', 'related', '--run', '--passWithNoTests', 'src/domains/tax/engine.ts']);
});
test('related selector rejects paths outside src and traversal', () => {
  assert.throws(() => parse(['--related', 'tests/x.test.ts']), /Invalid related selector/);
  assert.throws(() => parse(['--related', 'src/../etc/passwd.ts']), /Invalid related selector/);
});

test('the quick gate runs the same commands as full preflight, so its pass records are shared', () => {
  const quick = commands(parse(['--quick']), ['src/a.ts']).map(s => s.join(' '));
  const full = commands(parse(['--unit', 'tests/tax.test.ts']), ['src/a.ts']).map(s => s.join(' '));
  for (const step of quick) assert.ok(full.includes(step), step);
});
test('a test run and its skipped-test check are one record', () => {
  const groups = groupSteps([['npm', 'run', 'lint'], ['npx', '--no-install', 'vitest', 'run', 'tests/a.test.ts'], ['node', 'scripts/check-no-skipped-tests.mjs', 'vitest-results.json'], ['node', 'x']]);
  assert.deepEqual(groups.map(g => g.length), [1, 2, 1]);
});
test('stand-in font or browser changes what a pass record proves', () => {
  assert.notEqual(recordExtra({}), recordExtra({ LOCAL_TEST_FONT: '/f.woff2' }));
  assert.notEqual(recordExtra({}), recordExtra({ LOCAL_TEST_CHROMIUM: '/c' }));
});
test('--fresh reaches the database launcher', () => {
  const steps = commands(parse(['--fresh', '--db', 'tests/tax-integration.test.ts']), ['src/domains/tax/x.ts']);
  assert.deepEqual(steps.at(-1).slice(0, 4), ['bash', 'scripts/local-postgres-test.sh', '--checks', '--fresh']);
});
