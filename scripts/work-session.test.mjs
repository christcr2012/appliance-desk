import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkArguments, loadPacket, referenceExcerpt, safePath, validatePacket, validatePackets } from './work-packet.mjs';
import { changedFiles, continuation, doctor, main } from './work-session.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'work-packet-'));
  const write = (file, content) => { mkdirSync(resolve(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), content); };
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  write('docs/pr-cards/A.md', '# Current card'); write('docs/OWNER-INPUTS.md', '# Owner input');
  write('src/domain.ts', 'export function storedFact() {}'); write('tests/existing.test.ts', 'existing test');
  write('scripts/example.test.mjs', 'node test');
  write('package.json', JSON.stringify({ dependencies: { a: '1' }, devDependencies: {} }));
  write('package-lock.json', JSON.stringify({ packages: { '': { dependencies: { a: '1' }, devDependencies: {} } } }));
  git('add', '.'); git('commit', '-qm', 'base');
  const baseline = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', baseline);
  const packet = { version: 1, id: 'A-1', parent: 'A', baseline, card: 'docs/pr-cards/A.md',
    outcome: 'Complete one real capability', risk: 'Read only', next: 'Next reviewed capability',
    references: [{ path: 'src/domain.ts', anchor: 'storedFact', purpose: 'Existing function' }],
    proposedFiles: ['tests/new.test.ts'], invariants: ['No invented acceptance'], sequence: ['Implement and verify'],
    acceptance: ['Actual result proves behavior'], gates: [{ id: 'IN-1', source: 'docs/OWNER-INPUTS.md',
      affected: 'Only external acceptance', remedy: 'Inspect available evidence', reopen: 'Actual evidence available' }],
    checks: { unit: ['tests/existing.test.ts', 'tests/new.test.ts'], db: [], browser: [], node: ['scripts/example.test.mjs'] } };
  const index = { activeExecution: 'A-1', executionPackets: [{ id: 'A-1', path: 'docs/pr-cards/execution/A-1.json' }],
    cards: [{ id: 'A', title: 'Approved scope', status: 'APPROVED', dependencies: ['B'], evidence: ['src/domain.ts'], tests: [], plannedCard: 'docs/pr-cards/A.md' }] };
  const save = () => { write('docs/pr-cards/execution/A-1.json', JSON.stringify(packet)); write('docs/pr-cards/work-index.json', JSON.stringify(index)); };
  save();
  return { root, git, packet, index, write, save, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('existing integration anchors, parent ownership and active packet are checked, not assumed', () => {
  const f = fixture(); try {
    assert.equal(loadPacket(f.root, f.index).id, 'A-1');
    assert.equal(validatePackets(f.root, f.index).length, 1);
    f.packet.references[0].anchor = 'renamedFunction'; f.save();
    assert.throws(() => loadPacket(f.root, f.index), /Stale reference/);
    f.packet.references[0].anchor = 'storedFact'; f.packet.parent = 'FOREIGN'; f.save();
    assert.throws(() => loadPacket(f.root, f.index), /indexed acceptance/);
    f.index.activeExecution = 'MISSING';
    assert.throws(() => validatePackets(f.root, f.index), /not registered/);
  } finally { f.cleanup(); }
});

test('no arbitrary shell commands, option injection, traversal or missing existing tests in packets', () => {
  const f = fixture(); try {
    for (const file of ['tests/../outside.test.ts', '--all', 'tests/a.test.ts;touch', '/tmp/a.test.ts']) {
      const packet = structuredClone(f.packet); packet.checks.unit = [file];
      assert.throws(() => validatePacket(packet, f.root));
    }
    const packet = structuredClone(f.packet); packet.checks.node = ['scripts/do-stuff.mjs'];
    assert.throws(() => validatePacket(packet, f.root), /Invalid node/);
    packet.checks.node = []; packet.checks.unit = ['tests/missing.test.ts'];
    assert.throws(() => validatePacket(packet, f.root), /Missing repository/);
    for (const file of ['../outside', '.git/config', 'src//a.ts', 'src/./a.ts', '/tmp/test'])
      assert.throws(() => safePath(f.root, file, false));
  } finally { f.cleanup(); }
});

test('existing and proposed paths through an escaping symlink are denied', () => {
  const f = fixture(); const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  try {
    writeFileSync(join(outside, 'file.ts'), 'external'); symlinkSync(outside, join(f.root, 'escape'));
    assert.throws(() => safePath(f.root, 'escape/file.ts'), /escapes/);
    assert.throws(() => safePath(f.root, 'escape/proposed.ts', false), /escapes/);
  } finally { f.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test('an innocent-looking alias cannot expose an ignored environment file or private Git metadata', () => {
  const f = fixture(); try {
    f.write('.env.local', 'private fixture');
    symlinkSync(join(f.root, '.env.local'), join(f.root, 'src', 'environment-alias.ts'));
    symlinkSync(join(f.root, '.git', 'config'), join(f.root, 'src', 'git-alias.ts'));
    assert.throws(() => safePath(f.root, 'src/environment-alias.ts'), /Protected private/);
    assert.throws(() => safePath(f.root, 'src/git-alias.ts'), /Protected private/);
  } finally { f.cleanup(); }
});

test('proposed regression is visible in plan but blocks verification until actually implemented', () => {
  const f = fixture(); try {
    assert.deepEqual(checkArguments(f.packet, f.root, { plan: true }).missing, ['tests/new.test.ts']);
    assert.throws(() => checkArguments(f.packet, f.root), /Implement planned regression/);
    const calls = [];
    assert.throws(() => main(['verify'], f.root, (...args) => { calls.push(args); return { status: 0 }; }, () => {}));
    assert.equal(calls.length, 0);
    f.write('tests/new.test.ts', 'implemented test');
    const selection = checkArguments(f.packet, f.root, { fresh: true });
    assert.ok(selection.args.includes('--fresh'));
    assert.ok(selection.args.includes('tests/new.test.ts'));
  } finally { f.cleanup(); }
});

test('verify uses validated argument vectors; failures, timeouts and signals never claim passing proof', () => {
  const f = fixture(); try {
    f.write('tests/new.test.ts', 'implemented');
    for (const result of [{ status: 3 }, { status: null, signal: 'SIGTERM' }, { error: new Error('timeout') }]) {
      const output = []; let calls = 0;
      assert.throws(() => main(['verify'], f.root, () => { calls++; return result; }, s => output.push(s)), /No passing evidence/);
      assert.equal(calls, 1); assert.ok(!output.some(s => s.includes('local checks passed')));
    }
    const calls = [];
    main(['verify', '--fresh'], f.root, (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: 0 }; }, () => {});
    assert.deepEqual(calls[0].args, ['--test', 'scripts/example.test.mjs']);
    assert.ok(calls[1].args.includes('--fresh'));
    assert.ok(!calls[1].options.shell);
    assert.throws(() => main(['probe'], f.root, () => ({ status: 0 }), () => {}), /no database specs/);
    assert.throws(() => main(['start', '--fresh'], f.root), /only with verify/);
    assert.throws(() => main(['start', 'A-1', 'A-2'], f.root), /one packet/);
  } finally { f.cleanup(); }
});

test('read-only startup, route and plan run without dependencies or provider/database inspection', () => {
  const f = fixture(); try {
    const output = []; const neverExecute = () => { throw new Error('Should not execute'); };
    for (const action of [['start'], ['check'], ['plan'], ['route', 'A']])
      assert.equal(main(action, f.root, neverExecute, s => output.push(s)), 0);
    assert.ok(output.some(s => s.includes('not verified readiness')));
    assert.ok(output.some(s => s.includes('missingPlannedTests')));
    assert.ok(output.some(s => s.includes('No invented acceptance')));
    assert.throws(() => main(['route', 'FOREIGN'], f.root, neverExecute), /indexed acceptance unit/);
  } finally { f.cleanup(); }
});

test('doctor diagnoses missing hook/dependencies and mismatched lock without disclosing environment values', () => {
  const f = fixture(); try {
    const report = doctor(f.root);
    assert.equal(report.issues.length, 2);
    assert.ok(report.issues.some(s => s.includes('npm run setup')));
    f.git('config', 'core.hooksPath', '.githooks'); mkdirSync(join(f.root, 'node_modules'));
    assert.deepEqual(doctor(f.root).issues, []);
    f.write('package-lock.json', '{}');
    assert.ok(doctor(f.root).issues.some(s => s.includes('disagree')));
    rmSync(join(f.root, 'node_modules'), { recursive: true }); symlinkSync('/missing-dependency-tree', join(f.root, 'node_modules'));
    // A dangling tree is absent; an existing tree elsewhere is specifically flagged as shared.
    assert.ok(doctor(f.root).issues.some(s => s.includes('Dependencies absent')));
  } finally { f.cleanup(); }
});

test('drift includes unstaged, staged, untracked and predecessor changes; prompts do not invent merge evidence', () => {
  const f = fixture(); try {
    f.write('src/domain.ts', 'export function storedFact() { return 1; }');
    f.write('tests/new.test.ts', 'new');
    assert.ok(changedFiles(f.root).includes('src/domain.ts'));
    assert.ok(changedFiles(f.root).includes('tests/new.test.ts'));
    f.git('add', '.'); f.git('commit', '-qm', 'new work');
    assert.ok(changedFiles(f.root, f.packet.baseline).includes('src/domain.ts'));
    const prompt = continuation(f.packet, f.git('rev-parse', 'HEAD'));
    assert.ok(prompt.includes('not proof of GitHub merge or CI'));
    assert.ok(prompt.includes('bundle workload'));
    assert.throws(() => continuation(f.packet, 'unknown'), /Invalid local head/);
  } finally { f.cleanup(); }
});

test('actual repository packet remains bounded and routes to current inspected symbols', () => {
  const root = resolve(import.meta.dirname, '..');
  const index = JSON.parse(readFileSync(join(root, 'docs/pr-cards/work-index.json'), 'utf8'));
  const packets = validatePackets(root, index);
  assert.ok(packets.length > 0);
  for (const packet of packets) assert.ok(packet.references.length <= 12, 'bounded integration read');
});

test('numbered reads expose only bounded context around a checked integration anchor', () => {
  const f = fixture(); try {
    f.write('src/domain.ts', Array.from({ length: 400 }, (_, n) => n === 200 ? 'export function storedFact() {}' : `line ${n}`).join('\n'));
    const excerpt = referenceExcerpt(f.packet, '1', f.root);
    assert.ok(excerpt.includes('storedFact'));
    assert.ok(!excerpt.includes('line 399'));
    assert.ok(!excerpt.includes('1: line 0'));
    assert.ok(excerpt.split('\n').length <= 103);
    for (const n of ['0', '../file', '01', '2', '--all']) assert.throws(() => referenceExcerpt(f.packet, n, f.root));
    const output = [];
    main(['read', '1'], f.root, () => { throw new Error('No check execution'); }, s => output.push(s));
    assert.equal(output[0], excerpt);
    f.packet.references = Array(13).fill(f.packet.references[0]);
    assert.throws(() => validatePacket(f.packet, f.root), /bounded/);
  } finally { f.cleanup(); }
});
