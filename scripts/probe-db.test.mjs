import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeArgs, commandFor, main } from './probe-db.mjs';

const exists = file => file === 'tests/w22.test.ts' || file === 'tests/w22b.test.ts';
test('explicit specs only, ordered and deduplicated', () => {
  assert.deepEqual(probeArgs(['tests/w22.test.ts', 'tests/w22.test.ts', 'tests/w22b.test.ts'], exists),
    ['tests/w22.test.ts', 'tests/w22b.test.ts']);
});
test('reject missing, traversal, option injection and blanket invocation', () => {
  for (const args of [[], ['../tests/w22.test.ts'], ['tests/../secret.test.ts'],
    ['--all'], ['tests/missing.test.ts'], ['src/domains/billing/index.ts']])
    assert.throws(() => probeArgs(args, exists));
});
test('runs a bounded disposable isolated database, never the affected graph', () => {
  const cmd = commandFor(['tests/w22.test.ts', 'tests/w22b.test.ts']);
  assert.deepEqual(cmd, ['bash', 'scripts/local-postgres-test.sh', '--checks', '--inside',
    '--db', 'tests/w22.test.ts', '--db', 'tests/w22b.test.ts']);
  assert.ok(!cmd.includes('--related'));
});
test('reports failed execution and never presents a failure as success', () => {
  let seen;
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    const outcome = main(['tests/signing-charge-readiness-w22.test.ts'], (bin, args, opts) => {
      seen = { bin, args, opts };
      return { status: 1 };
    });
    assert.equal(outcome, 1);
    assert.equal(seen.opts.timeout, 600000);
    assert.equal(seen.opts.env.CI, 'true');
  } finally { process.stdout.write = original; }
});
