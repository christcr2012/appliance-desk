import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceSnapshot, acceptanceSummary, reviewAcceptance as reviewWithAncestry, readQueue, planQueue, missingRoadmapAcceptance, run } from './session-status.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const row = (id = 'READ', revision = a) => ({ id, priority: 1, requiredRevision: revision, task: 'Read custom service', procedure: 'docs/ACCEPTANCE.md', gates: 'Existing scoped owner grant', lastEvidence: 'Not run', dependsOn: [], status: 'PENDING' });
const block = rows => '<!-- release-acceptance:start -->\n```json\n' + JSON.stringify(rows) + '\n```\n<!-- release-acceptance:end -->';
const obs = { main: c, live: b, deployed: b, deploymentState: 'READY' };
const ancestor = (x, y) => [a, b, c].indexOf(x) <= [a, b, c].indexOf(y);
const reviewAcceptance = (plan, observation, report) => reviewWithAncestry(plan, observation, report, ancestor);

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
test('advancing roadmap requires predecessor release-acceptance rows, never imagined passes', () => {
  const rowFor = id => row(id, a);
  assert.deepEqual(missingRoadmapAcceptance([], 'W-22FIN'), []);
  assert.deepEqual(missingRoadmapAcceptance([], 'W-23'), ['W-23']);
  assert.deepEqual(missingRoadmapAcceptance([rowFor('W23-UNVERIFIED')], 'W-24'), ['W-24']);
  assert.deepEqual(missingRoadmapAcceptance([
    rowFor('W23-UNVERIFIED'), rowFor('W24-UNVERIFIED')], 'W-25'), ['W-25']);
  const queue = ['W23-TEST','W24-TEST','W25-TEST'].map(rowFor);
  assert.deepEqual(missingRoadmapAcceptance(queue, 'W-25'), []);
  assert.deepEqual(missingRoadmapAcceptance(queue, 'W-26'), []);
  assert.deepEqual(queue.map(r => r.status), ['PENDING','PENDING','PENDING']);
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
    mkdirSync(join(root, 'docs/pr-cards'));
    writeFileSync(join(root, 'docs/pr-cards/work-index.json'), JSON.stringify({ activeExecution: 'W-22FIN' }));
    writeFileSync(join(root, 'docs/session-policy.json'), JSON.stringify({ repository: 'fixture/repo', ledger: 'docs/STATUS.md', instructions: 'AGENTS.md' }));
    writeFileSync(join(root, 'docs/STATUS.md'), block([row('FIRST', first), row('SECOND', second)]));
    writeFileSync(join(root, 'acceptance.json'), JSON.stringify({ snapshot: acceptanceSnapshot(planQueue([row('FIRST', first), row('SECOND', second)], { main: second, live: first, deployed: first, deploymentState: 'READY' }, (x, y) => x === y || x === first && y === second)), deployed: first, deploymentState: 'READY', tasks: [
      { id: 'FIRST', requiredRevision: first, disposition: 'DEPLOYED_CANDIDATE_CHECK_GATES', outcome: 'PERFORMED', result: 'PASS', evidence: 'Fixture observation only' },
      { id: 'SECOND', requiredRevision: second, disposition: 'WAIT_RELEASE_OR_FETCH_HISTORY', outcome: 'DEFERRED', evidence: 'Fixture ancestry', prerequisite: 'Release', remedy: 'Checked fixture history', nextAction: 'Retest deployed successor' }
    ] }));
    const before = git('status', '--porcelain');
    const output = run(root, ['--deployed', first, '--state', 'READY', '--latest-pr', '104']);
    assert.match(output, /PR work unit = one whole predefined batch subsection/);
    assert.match(output, /Partial subsection = zero completed batch subsections/);
    assert.match(output, /FIRST DEPLOYED_CANDIDATE_CHECK_GATES/); assert.match(output, /SECOND WAIT_RELEASE_OR_FETCH_HISTORY/); assert.match(output, /Latest observed PR: #104 \(informational only/); assert.doesNotMatch(output, /Next session boundary/);
    assert.match(run(root, ['--deployed', first, '--state', 'READY', '--acceptance-review', 'acceptance.json']), /accounting checked/);
    assert.equal(git('status', '--porcelain'), before);
    assert.match(run(root, []), /VERIFY_DEPLOYMENT/);
    assert.throws(() => run(root, ['--deployed', first])); assert.throws(() => run(root, ['--deployed', first, '--state', 'FAKE'])); assert.throws(() => run(root, ['--latest-pr', '1.5']));
    writeFileSync(join(root, 'docs/STATUS.md'), block(Array.from({ length: 12 }, (_, i) => row(`TASK-${i}`, first))));
    assert.match(run(root, []), /2 additional tasks/);
    assert.doesNotMatch(run(root, ['--limit', '12']), /additional tasks/);
    assert.throws(() => run(root, ['--limit', '0']));
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('acceptance actions cannot be buried behind a limited waiting backlog', () => {
  const waiting = Array.from({ length: 12 }, (_, i) => ({ ...row(`WAIT-${i}`, c), priority: i + 1 }));
  const candidate = { ...row('ACTION', a), priority: 20 };
  const blocked = { ...row('GATE', a), priority: 21, status: 'BLOCKED' };
  const plan = planQueue([...waiting, candidate, blocked], obs, ancestor);
  const text = acceptanceSummary(plan, 1).join('\n');
  assert.ok(text.indexOf('ACTION DEPLOYED_CANDIDATE_CHECK_GATES') < text.indexOf('WAIT-0 WAIT_RELEASE'));
  assert.match(text, /2 deployed tasks/);
  assert.match(text, /1 additional tasks in this group/);
  assert.doesNotMatch(text, /deployment match/);
});

test('acceptance accounting refuses omissions, stale revisions and unsupported claims', () => {
  const plan = planQueue([row('OLD', a), row('NEW', c)], obs, ancestor);
  const performed = { id: 'OLD', requiredRevision: a, disposition: plan.find(x => x.id === 'OLD').disposition,
    outcome: 'PERFORMED', result: 'PASS', evidence: 'Sanitized custom read and denial observations at deployed revision.' };
  const deferred = { id: 'NEW', requiredRevision: c, disposition: plan.find(x => x.id === 'NEW').disposition,
    outcome: 'DEFERRED', evidence: 'Exact ancestry comparison excludes required revision.',
    prerequisite: 'Release containing NEW code', remedy: 'Verified actual production revision and compared history',
    nextAction: 'Run after that revision is deployed under existing release policy' };
  const report = { snapshot: acceptanceSnapshot(plan), deployed: b, deploymentState: 'READY', tasks: [performed, deferred] };
  assert.match(reviewAcceptance(plan, obs, report), /accounting checked/);
  for (const tasks of [[performed], [performed, performed], [{ ...performed, requiredRevision: c }, deferred],
    [performed, { ...deferred, remedy: '' }], [performed, { ...deferred, outcome: 'PERFORMED', result: 'PASS' }],
    [{ ...performed, outcome: 'REUSED' }, deferred], [{ ...performed, result: 'FAIL' }, deferred]])
    assert.throws(() => reviewAcceptance(plan, obs, { ...report, tasks }));
  assert.throws(() => reviewAcceptance(plan, obs, { ...report, deployed: c }));
  assert.throws(() => reviewAcceptance(plan, obs, { ...report, deploymentState: 'BUILDING' }));
  const before = JSON.stringify(plan);
  assert.match(reviewAcceptance(plan, obs, { ...report, tasks: [{ ...performed, result: 'FAIL', nextAction: 'Repair verified defect' }, deferred] }), /independently reviewed/);
  assert.equal(JSON.stringify(plan), before);
  const passed = planQueue([{ ...row(), status: 'PASSED' }], obs, ancestor);
  assert.match(reviewAcceptance(passed, obs, { ...report, snapshot: acceptanceSnapshot(passed), tasks: [] }), /accounting checked/);
});


test('accounting binds the entire queue and refuses unknown deployment checkpoints', () => {
  const plan = planQueue([row('WAIT', c)], obs, ancestor);
  const entry = { id: 'WAIT', requiredRevision: c, disposition: plan[0].disposition,
    outcome: 'DEFERRED', evidence: 'Revision not deployed', prerequisite: 'Checked release',
    remedy: 'Compared exact revisions', nextAction: 'Run after release' };
  const report = { snapshot: acceptanceSnapshot(plan), deployed: b, deploymentState: 'READY', tasks: [entry] };
  for (const key of ['task', 'procedure', 'gates', 'lastEvidence', 'dependsOn', 'status']) {
    const changed = [{ ...plan[0], [key]: key === 'dependsOn' ? ['NEW-DEPENDENCY'] : 'Changed requirement' }];
    assert.throws(() => reviewAcceptance(changed, obs, report));
  }
  for (const change of [{ deployed: null, deploymentState: 'UNKNOWN' }, { deploymentState: 'BUILDING' }]) {
    const observation = { ...obs, ...change };
    const unresolved = planQueue([row('WAIT', c)], observation, ancestor);
    assert.throws(() => reviewAcceptance(unresolved, observation, { ...report, ...change, snapshot: acceptanceSnapshot(unresolved), tasks: [{ ...entry, disposition: unresolved[0].disposition }] }));
  }
  const unknownHistory = planQueue([row()], obs, () => null);
  assert.throws(() => reviewAcceptance(unknownHistory, obs, { ...report, snapshot: acceptanceSnapshot(unknownHistory) }));
});


test('an empty queue cannot bypass deployment/ref ancestry verification', () => {
  const report = { snapshot: acceptanceSnapshot([]), deployed: b, deploymentState: 'READY', tasks: [] };
  assert.match(reviewWithAncestry([], obs, report, ancestor), /accounting checked/);
  for (const change of [{ main: null }, { live: null }, { deployed: null }, { deployed: c }])
    assert.throws(() => reviewWithAncestry([], { ...obs, ...change }, { ...report, deployed: change.deployed === undefined ? b : change.deployed }, ancestor));
  assert.throws(() => reviewWithAncestry([], obs, report));
  assert.throws(() => reviewWithAncestry([], obs, report, () => null));
  assert.throws(() => reviewWithAncestry([], obs, report, () => false));
});
