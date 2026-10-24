import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizedTestingInvocation, newestGreen } from './promote-testing.mjs';
import { latestDeploymentState } from './promote-live.mjs';

const repository = 'christcr2012/appliance-desk';
const base = { GITHUB_REPOSITORY: repository, GH_TOKEN: 'x', GITHUB_REF: 'refs/heads/main' };

test('testing promotion runs only on its schedule or for the owner', () => {
  assert.equal(authorizedTestingInvocation({ ...base, GITHUB_EVENT_NAME: 'schedule' }, repository), true);
  assert.equal(authorizedTestingInvocation({ ...base, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_ACTOR: 'christcr2012', GITHUB_TRIGGERING_ACTOR: 'christcr2012' }, repository), true);
  for (const patch of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'someone', GITHUB_TRIGGERING_ACTOR: 'someone' },
    { GITHUB_EVENT_NAME: 'schedule', GITHUB_REPOSITORY: 'someone/fork' },
    { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'schedule', GH_TOKEN: '' }])
    assert.equal(authorizedTestingInvocation({ ...base, ...patch }, repository), false);
});

test('picks the newest main commit whose checks all passed', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
  const ok = (sha, name) => ({ id: 1, name, head_sha: sha, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' });
  const runs = { [a]: [ok(a, 'ci')], [b]: [ok(b, 'ci'), ok(b, 'release-policy')], [c]: [ok(c, 'ci'), ok(c, 'release-policy')] };
  assert.equal(newestGreen([a, b, c], runs, ['ci', 'release-policy']), b);
  assert.equal(newestGreen([a], runs, ['ci', 'release-policy']), null);
});

test('production waits for, or refuses, the testing app build of the same commit', () => {
  const ctx = 'Vercel – appliance-desk-testing';
  const s = (state, at, extra = {}) => ({ id: 1, context: ctx, state, created_at: at, creator: { login: 'vercel[bot]' }, ...extra });
  assert.equal(latestDeploymentState([s('pending', '2026-10-24T13:04:51Z'), s('success', '2026-10-24T13:05:46Z')], ctx), 'success');
  assert.equal(latestDeploymentState([s('success', '2026-10-24T13:05:46Z'), s('failure', '2026-10-24T13:19:35Z')], ctx), 'failure');
  assert.equal(latestDeploymentState([s('success', '2026-10-24T13:05:46Z', { creator: { login: 'someone' } })], ctx), 'missing');
  assert.equal(latestDeploymentState([s('success', '2026-10-24T13:05:46Z', { context: 'Vercel' })], ctx), 'missing');
  assert.equal(latestDeploymentState([], ctx), 'missing');
});
