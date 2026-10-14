import test from 'node:test';
import assert from 'node:assert/strict';
import { checksPass, checksFailed, decide, denverDay, releaseEventAllowed, run } from './promote-live.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
const main = 'a'.repeat(40), live = 'b'.repeat(40);
const good = { id: 1, name: 'ci', head_sha: main, app: { slug: 'github-actions' },
  status: 'completed', conclusion: 'success' };
test('Actions repository identity matches the deployed policy', () => {
  const path = new URL('./policy.json', import.meta.url);
  if (process.env.GITHUB_REPOSITORY && existsSync(path)) {
    const policy = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(policy.repository, process.env.GITHUB_REPOSITORY);
    assert.ok(policy.requiredChecks.includes('release-policy'));
  }
});
test('Denver calendar dates honor midnight and DST', () => {
  assert.equal(denverDay(new Date('2026-10-12T05:59:59Z')), '2026-10-11');
  assert.equal(denverDay(new Date('2026-10-12T06:00:00Z')), '2026-10-12');
  assert.equal(denverDay(new Date('2026-12-12T06:59:59Z')), '2026-12-11');
});
test('requires successful latest exact-head trusted checks', () => {
  assert.equal(checksPass([good], ['ci'], main), true);
  for (const change of [{ conclusion: 'failure' }, { conclusion: 'skipped' },
    { status: 'in_progress' }, { head_sha: live }, { app: { slug: 'other' } }])
    assert.equal(checksPass([{ ...good, ...change }], ['ci'], main), false);
  assert.equal(checksPass([], ['ci'], main), false);
  assert.equal(checksPass([good, { ...good, id: 2, conclusion: 'failure' }], ['ci'], main), false);
  assert.equal(checksPass([good], ['ci', 'missing'], main), false);
  assert.equal(checksFailed([{ ...good, conclusion: 'failure' }], ['ci'], main), true);
  assert.equal(checksFailed([{ ...good, status: 'in_progress', conclusion: null }], ['ci'], main), false);
  assert.equal(checksFailed([{ ...good, head_sha: live, conclusion: 'failure' }], ['ci'], main), false);
});
test('one checked fast-forward daily; reruns and unchanged heads skip', () => {
  const state = { main, live, ancestor: true, green: true, alreadyToday: false };
  assert.equal(decide(state), 'promote');
  assert.equal(decide({ ...state, alreadyToday: true }), 'skip');
  assert.equal(decide({ ...state, live: main }), 'skip');
  assert.throws(() => decide({ ...state, ancestor: false }), /rewrite/);
  assert.throws(() => decide({ ...state, green: false }), /checks/);
  assert.throws(() => decide({ ...state, main: 'main' }), /identity/);
});
test('real atomic git promotion, read-back and second same-day update refusal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-policy-'));
  const cwd = process.cwd(), fetchBefore = globalThis.fetch;
  const keys = ['GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'GH_TOKEN'];
  const before = keys.map(k => process.env[k]);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init', '--bare', join(dir, 'remote.git'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Release test');
    git('remote', 'add', 'origin', join(dir, 'remote.git'));
    writeFileSync(join(dir, 'fixture.txt'), 'first');
    git('add', 'fixture.txt'); git('commit', '-m', 'first');
    git('push', 'origin', 'main', 'main:live');
    const original = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'fixture.txt'), 'second');
    git('commit', '-am', 'second'); git('push', 'origin', 'main');
    const second = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'fixture.txt'), 'concurrent agent');
    git('commit', '-am', 'concurrent main');
    const checked = git('rev-parse', 'HEAD');
    git('checkout', '--detach', original);
    Object.assign(process.env, { GITHUB_REPOSITORY: 'example/repo', GITHUB_REF: 'refs/heads/main',
      GITHUB_EVENT_NAME: 'schedule', GH_TOKEN: 'fixture' });
    process.chdir(dir);
    const policy = { repository: 'example/repo', requiredChecks: ['ci'] };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ total_count: 1,
      check_runs: [{ ...good, head_sha: second, conclusion: 'failure' }] }) });
    await assert.rejects(run(policy), /check failed/);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], original);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ total_count: 0, check_runs: [] }) });
    await assert.rejects(run(policy, { attempts: 2, pause: async () => {} }), /window exhausted/);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], original);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) git('push', 'origin', checked + ':refs/heads/main');
      return { ok: true, json: async () => ({ total_count: 1, check_runs: [{ ...good,
        head_sha: calls === 1 ? second : checked,
        status: calls === 2 ? 'in_progress' : 'completed' }] }) };
    };
    await run(policy, { attempts: 3, pause: async () => {} });
    assert.equal(calls, 3);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], checked);
    assert.equal(git('ls-remote', 'origin', 'refs/tags/live-promotion/' + denverDay()).split(/\s+/)[0], checked);
    git('checkout', 'main');
    writeFileSync(join(dir, 'fixture.txt'), 'third');
    git('commit', '-am', 'third'); git('push', 'origin', 'main');
    await run({ repository: 'example/repo', requiredChecks: ['ci'] });
    assert.equal(git('ls-remote', 'origin', 'refs/heads/live').split(/\s+/)[0], checked);
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    await assert.rejects(run({ repository: 'example/repo', requiredChecks: ['ci'] }), /Scheduled/);
  } finally {
    process.chdir(cwd); globalThis.fetch = fetchBefore;
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('owner release schedule is 00:01 Denver with native DST handling', () => {
  const workflow = readFileSync(new URL('../workflows/daily-live.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/^\s*- cron:/gm) || []).length, 3);
  assert.match(workflow, /- cron: '1 0 \* \* \*'[^\n]*\n\s+timezone: America\/Denver\s*\n/);
});

test('missed release recovery is strictly owner and exact Denver date', () => {
  const allowed = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'christcr2012',
    RECOVERY_DENVER_DAY: '2026-10-14' };
  assert.equal(releaseEventAllowed(allowed, '2026-10-14'), true);
  assert.equal(releaseEventAllowed({ ...allowed, GITHUB_ACTOR: 'app[bot]' }, '2026-10-14'), false);
  assert.equal(releaseEventAllowed({ ...allowed, RECOVERY_DENVER_DAY: '2026-10-13' }, '2026-10-14'), false);
  assert.equal(releaseEventAllowed(allowed, '2026-10-15'), false);
  assert.equal(releaseEventAllowed({ GITHUB_EVENT_NAME: 'pull_request' }, '2026-10-14'), false);
  assert.equal(releaseEventAllowed({ GITHUB_EVENT_NAME: 'schedule' }, '2026-10-14'), true);
});
