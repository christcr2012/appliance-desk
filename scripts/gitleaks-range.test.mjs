import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectGitleaksLogOpts } from './gitleaks-range.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const map = { HEAD: C, [A]: A, [B]: B, [C]: C, 'refs/remotes/origin/main': A };
const stubs = {
  resolveCommit: ref => { if (!(ref in map)) throw Error('unknown ref'); return map[ref]; },
  isAncestor: () => true
};

test('PR excludes main and unrelated branch commits', () => {
  assert.equal(selectGitleaksLogOpts({
    EVENT_NAME: 'pull_request', PR_BASE_SHA: A, PR_HEAD_SHA: B
  }, stubs), B + ' ^' + A);
});

test('PR fails closed if base/head is missing or cannot be resolved', () => {
  assert.throws(() => selectGitleaksLogOpts({
    EVENT_NAME: 'pull_request', PR_BASE_SHA: '', PR_HEAD_SHA: B
  }, stubs));
  assert.throws(() => selectGitleaksLogOpts({
    EVENT_NAME: 'pull_request', PR_BASE_SHA: A, PR_HEAD_SHA: 'f'.repeat(40)
  }, stubs));
});

test('push scans new commits, widening safely for missing or unrelated before SHA', () => {
  assert.equal(selectGitleaksLogOpts({
    EVENT_NAME: 'push', PUSH_AFTER_SHA: C, PUSH_BEFORE_SHA: A
  }, stubs), C + ' ^' + A);
  assert.equal(selectGitleaksLogOpts({
    EVENT_NAME: 'push', PUSH_AFTER_SHA: C, PUSH_BEFORE_SHA: '0'.repeat(40)
  }, stubs), C);
  assert.equal(selectGitleaksLogOpts({
    EVENT_NAME: 'push', PUSH_AFTER_SHA: C, PUSH_BEFORE_SHA: A
  }, { ...stubs, isAncestor: () => false }), C);
  assert.throws(() => selectGitleaksLogOpts({
    EVENT_NAME: 'push', PUSH_AFTER_SHA: B, PUSH_BEFORE_SHA: A
  }, stubs));
});

test('nightly scans current ancestry; manual run compares base or widens safely', () => {
  assert.equal(selectGitleaksLogOpts({ EVENT_NAME: 'schedule' }, stubs), C);
  assert.equal(selectGitleaksLogOpts({ EVENT_NAME: 'workflow_dispatch' }, stubs), C + ' ^' + A);
  assert.equal(selectGitleaksLogOpts({
    EVENT_NAME: 'workflow_dispatch', DISPATCH_BASE: 'missing'
  }, stubs), C);
  assert.throws(() => selectGitleaksLogOpts({
    EVENT_NAME: 'workflow_dispatch', DISPATCH_BASE: '../other'
  }, stubs));
  assert.throws(() => selectGitleaksLogOpts({ EVENT_NAME: 'unexpected' }, stubs));
});

test('real git history selects feature changes but not another branch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitleaks-range-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const commit = message => {
    git('commit', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'ci@example.test');
    git('config', 'user.name', 'CI Fixture');
    const base = commit('base');
    git('checkout', '-q', '-b', 'other');
    commit('unrelated-branch-change');
    git('checkout', '-q', '-b', 'feature', base);
    const feature = commit('feature-change');
    const opts = selectGitleaksLogOpts({
      EVENT_NAME: 'pull_request', PR_BASE_SHA: base, PR_HEAD_SHA: feature
    }, { resolveCommit: ref => git('rev-parse', '--verify', ref + '^{commit}') });
    assert.deepEqual(git('log', '--format=%s', ...opts.split(' ')).split('\n'), ['feature-change']);
    assert.match(git('log', '--format=%s', feature), /base/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
