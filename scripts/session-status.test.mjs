import test from 'node:test';
import assert from 'node:assert/strict';
import { readQueue, planQueue, run } from './session-status.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const row = (id = 'READ', revision = a) => ({ id, priority: 1, requiredRevision: revision, task: 'Read custom service', procedure: 'docs/ACCEPTANCE.md', gates: 'Existing scoped owner grant', lastEvidence: 'Not run', dependsOn: [], status: 'PENDING' });
const block = rows => '<!-- release-acceptance:start -->\n```json\n' + JSON.stringify(rows) + '\n```\n<!-- release-acceptance:end -->';
const obs = { main: c, live: b, deployed: b, deploymentState: 'READY' };
const ancestor = (x, y) => [a, b, c].indexOf(x) <= [a, b, c].indexOf(y);

test('partial release clears older work without main/live equality', () => {
  const plan = planQueue([row('OLD', a), row('NEW', c)], obs, ancestor);
  assert.equal(plan.find(x => x.id === 'OLD').disposition, 'DEPLOYED_CANDIDATE_CHECK_GATES');
  assert.equal(plan.find(x => x.id === 'NEW').disposition, 'WAIT_RELEASE_OR_FETCH_HISTORY');
});
test('equal branches without READY production do not clear work', () => {
  for (const change of [{ deployed: null }, { deploymentState: 'BUILDING' }, { live: null }]) {
    assert.equal(planQueue([row()], { ...obs, main: b, ...change }, ancestor)[0].disposition, 'VERIFY_DEPLOYMENT');
  }
});
test('divergent refs, unknown history and production ahead of live fail closed', () => {
  assert.equal(planQueue([row()], obs, () => false)[0].disposition, 'VERIFY_DEPLOYMENT');
  assert.equal(planQueue([row()], { ...obs, deployed: c }, ancestor)[0].disposition, 'VERIFY_DEPLOYMENT');
  assert.equal(planQueue([row()], obs, (x, y) => x === y ? true : null)[0].disposition, 'VERIFY_DEPLOYMENT');
});
test('passed dependencies require their deployed code; rollback reopens proof', () => {
  const first = { ...row('FIRST', c), status: 'PASSED' };
  const second = { ...row('SECOND', a), dependsOn: ['FIRST'] };
  const plan = planQueue([first, second], obs, ancestor);
  assert.equal(plan[0].disposition, 'RECHECK_AFTER_ROLLBACK');
  assert.equal(plan[1].disposition, 'WAIT_ACCEPTANCE_DEPENDENCY');
  first.requiredRevision = a;
  assert.equal(planQueue([first, second], obs, ancestor)[1].disposition, 'DEPLOYED_CANDIDATE_CHECK_GATES');
});
test('external gates are reconsidered; priority is stable and source rows are untouched', () => {
  const rows = [{ ...row('LATER'), priority: 2 }, { ...row('BLOCKED'), status: 'BLOCKED' }];
  const before = JSON.stringify(rows);
  assert.equal(planQueue(rows, obs, ancestor)[0].disposition, 'RECHECK_EXTERNAL_GATE');
  assert.equal(JSON.stringify(rows), before);
});
test('invalid, duplicate, missing, unknown and cyclic queue entries are refused', () => {
  for (const text of ['none', block([]) + block([]), block([row(), row()]), block([{ ...row(), requiredRevision: 'main' }]), block([{ ...row(), dependsOn: ['MISSING'] }]), block([{ ...row(), dependsOn: ['READ'] }]), block([{ ...row(), procedure: '' }])]) assert.throws(() => readQueue(text));
  assert.deepEqual(readQueue(block([])), []);
});
test('PR count is informational and cannot dictate a session boundary', () => {
  assert.doesNotMatch(run.toString(), /Next session boundary/);
});
test('real git refs and ancestry drive the offline CLI without network/mutations', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-status-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'file'), 'first'); git('add', '.'); git('commit', '-m', 'first'); const first = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'file'), 'second'); git('add', '.'); git('commit', '-m', 'second'); const second = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', second); git('update-ref', 'refs/remotes/origin/live', first);
    writeFileSync(join(root, 'docs/session-policy.json'), JSON.stringify({ repository: 'fixture/repo', ledger: 'docs/STATUS.md', instructions: 'AGENTS.md' }));
    writeFileSync(join(root, 'docs/STATUS.md'), block([row('FIRST', first), row('SECOND', second)]));
    const before = git('status', '--porcelain');
    const output = run(root, ['--deployed', first, '--state', 'READY', '--latest-pr', '104']);
    assert.match(output, /FIRST DEPLOYED_CANDIDATE_CHECK_GATES/); assert.match(output, /SECOND WAIT_RELEASE_OR_FETCH_HISTORY/); assert.match(output, /Latest observed PR: #104 \(informational only/); assert.doesNotMatch(output, /Next session boundary/);
    assert.equal(git('status', '--porcelain'), before);
    assert.match(run(root, []), /VERIFY_DEPLOYMENT/);
    assert.throws(() => run(root, ['--deployed', first])); assert.throws(() => run(root, ['--deployed', first, '--state', 'FAKE'])); assert.throws(() => run(root, ['--latest-pr', '1.5']));
    writeFileSync(join(root, 'docs/STATUS.md'), block(Array.from({ length: 12 }, (_, i) => row(`TASK-${i}`, first))));
    assert.match(run(root, []), /2 additional tasks/);
    assert.doesNotMatch(run(root, ['--limit', '12']), /additional tasks/);
    assert.throws(() => run(root, ['--limit', '0']));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
