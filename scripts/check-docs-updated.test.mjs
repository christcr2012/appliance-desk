import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingDocs } from './check-docs-updated.mjs';

test('docs-only or tooling-only changes need nothing', () => {
  assert.deepEqual(missingDocs(['docs/PLAN.md', 'scripts/x.mjs', '.github/workflows/ci.yml']), []);
});
test('app change without STATUS or card update is flagged', () => {
  const missing = missingDocs(['src/domains/tax/engine.ts']);
  assert.equal(missing.length, 2);
  assert.ok(missing[0].startsWith('docs/STATUS.md'));
});
test('app change with STATUS and card update passes', () => {
  assert.deepEqual(missingDocs(['src/a.ts', 'docs/STATUS.md', 'docs/pr-cards/W-0A.md']), []);
  assert.deepEqual(missingDocs(['src/a.ts', 'docs/STATUS.md', 'docs/pr-cards/work-index.json']), []);
});
test('schema change also needs DATABASE.md', () => {
  assert.deepEqual(missingDocs(['prisma/schema.prisma', 'docs/STATUS.md', 'docs/pr-cards/W-1.md']),
    ['docs/DATABASE.md (schema changed)']);
});
test('a reasoned escape line in the PR description is accepted; a bare one is not', () => {
  assert.deepEqual(missingDocs(['src/a.ts'], 'Fixes a typo.\nDocs-update: not needed — comment-only change'), []);
  assert.equal(missingDocs(['src/a.ts'], 'Docs-update: not needed').length, 2);
});
