import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeGroups } from './preflight.mjs';
import { recordTiming } from './preflight-evidence.mjs';

test('timing journal is bounded and distinguishes failed/passed/cached work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-timing-'));
  try {
    for (let n = 0; n < 205; n++) recordTiming({ status: n % 2 ? 'passed' : 'cached', elapsedMs: n, commands: [['node', 'check.mjs']] }, dir);
    const rows = readFileSync(join(dir, 'preflight-runs.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
    assert.equal(rows.length, 200); assert.equal(rows[0].elapsedMs, 5); assert.equal(rows.at(-1).elapsedMs, 204);
    assert.throws(() => recordTiming({ status: 'accepted', elapsedMs: 0, commands: [] }, dir));
    assert.throws(() => recordTiming({ status: 'passed', elapsedMs: NaN, commands: [] }, dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed report consumer invalidates entire test group, records failure and never writes a pass', () => {
  const marked = [], records = []; let clock = 0;
  const steps = [['npx', 'vitest'], ['node', 'scripts/check-no-skipped-tests.mjs', 'report.json']];
  assert.throws(() => executeGroups(steps, { fingerprint: 'f', passed: () => false,
    mark: n => marked.push(n), execute: step => { if (step[0] === 'node') throw new Error('skipped tests'); },
    record: r => records.push(r), clock: () => clock += 50, output: () => {} }), /skipped/);
  assert.equal(marked.length, 0); assert.equal(records[0].status, 'failed'); assert.equal(records[0].elapsedMs, 50);
  assert.equal(records[0].commands.length, 2);
});

test('plan has no cache, execution, timing or pass effects; fresh ignores cache and reruns groups', () => {
  const never = () => { throw new Error('No effect allowed'); };
  executeGroups([['node', 'check.mjs']], { plan: true, passed: never, mark: never, execute: never, record: never, output: () => {} });
  const records = [], commands = [], marked = [];
  const opts = { passed: () => true, mark: n => marked.push(n), execute: s => commands.push(s), record: r => records.push(r), output: () => {} };
  executeGroups([['node', 'check.mjs']], opts);
  assert.equal(commands.length, 0); assert.equal(marked.length, 0); assert.equal(records[0].status, 'cached');
  executeGroups([['node', 'check.mjs']], { ...opts, fresh: true });
  assert.equal(commands.length, 1); assert.equal(marked.length, 1); assert.equal(records[1].status, 'passed');
});

test('optional timing storage failure neither hides an actual check failure nor blocks a passing check', () => {
  const opts = { passed: () => false, mark: () => {}, record: () => { throw new Error('read-only directory'); }, output: () => {} };
  assert.throws(() => executeGroups([['node', 'check']], { ...opts, execute: () => { throw new Error('actual failure'); } }), /actual failure/);
  assert.doesNotThrow(() => executeGroups([['node', 'check']], { ...opts, execute: () => {} }));
});
