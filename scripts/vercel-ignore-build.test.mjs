import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isAppFile } from './vercel-ignore-build.mjs';

const prev = 'a'.repeat(40);

test('docs, tests, browser specs and CI files never trigger a paid build', () => {
  for (const file of ['docs/STATUS.md', 'README.md', 'tests/x.test.ts', 'e2e/a.spec.ts', '.github/workflows/ci.yml',
    '.githooks/pre-push', 'scripts/preflight.test.mjs', 'playwright.config.ts', 'vitest.config.ts'])
    assert.equal(isAppFile(file), false, file);
  assert.equal(decide({ branch: 'ai/x', previousSha: prev, changed: ['docs/STATUS.md', 'tests/x.test.ts'] }).build, false);
});

test('anything the site is built from builds', () => {
  for (const file of ['src/app/page.tsx', 'prisma/schema.prisma', 'public/logo.svg', 'package.json', 'package-lock.json',
    'next.config.ts', 'vercel.json', 'scripts/verify-schema-health.ts', 'scripts/check-migrations.mjs'])
    assert.equal(isAppFile(file), true, file);
  assert.equal(decide({ branch: 'main', previousSha: prev, changed: ['docs/a.md', 'src/x.ts'] }).build, true);
});

test('uncertain cases build', () => {
  assert.equal(decide({ branch: 'ai/x', previousSha: '' }).build, true);
  assert.equal(decide({ branch: 'ai/x', previousSha: prev, changed: null }).build, true);
  assert.equal(decide({ branch: 'ai/x', previousSha: prev, changed: [] }).build, true);
});

test('transfer branches never build', () => {
  assert.equal(decide({ branch: 'transfer/ai-x-123', previousSha: '' }).build, false);
});
