import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleTestingRun } from './promote-testing.mjs';
const repository = 'christcr2012/appliance-desk';
const run = { name: 'CI', event: 'push', head_branch: 'main', head_repository: { full_name: repository }, conclusion: 'success', head_sha: 'a'.repeat(40) };
test('testing promotion accepts only successful same-repository main push CI', () => {
  assert.equal(eligibleTestingRun({ workflow_run: run }, repository), true);
  for (const patch of [{ event: 'pull_request' }, { head_branch: 'feature' }, { conclusion: 'failure' },
    { head_repository: { full_name: 'someone/fork' } }, { name: 'Other' }, { head_sha: 'main' }])
    assert.equal(eligibleTestingRun({ workflow_run: { ...run, ...patch } }, repository), false);
});
