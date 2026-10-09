import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, commands, adjacentRegressions, run, verifyBrowserReport } from './preflight.mjs';

test('documentation avoids app work but preserves static repository checks', () => {
  const steps = commands(parse([]), ['docs/STATUS.md']);
  assert.equal(steps.length, 4);
  assert.ok(steps.some(s => s.includes('scripts/check-secrets.mjs')));
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
  assert.ok(checks[0].includes('tests/tax-integration.test.ts'));
  assert.ok(checks[0].includes('tests/tax.test.ts'));
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
