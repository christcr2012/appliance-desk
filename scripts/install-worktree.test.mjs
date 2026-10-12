import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installEnvironment, installWorktree } from './install-worktree.mjs';

test('installer overrides inherited real database/deployment/provider values without exposing them', () => {
  const env = installEnvironment({ PATH: '/bin', npm_config_registry: 'registry', NODE_ENV: 'production',
    DATABASE_URL: 'sensitive', DIRECT_URL: 'sensitive', VERCEL_ENV: 'preview', VERCEL_OIDC_TOKEN: 'sensitive',
    STRIPE_SECRET_KEY: 'sensitive', TWILIO_AUTH_TOKEN: 'sensitive', RESEND_API_KEY: 'sensitive', PRIVATE_BLOB_READ_WRITE_TOKEN: 'sensitive' });
  assert.equal(new URL(env.DIRECT_URL).hostname, 'localhost');
  assert.equal(env.DIRECT_URL, env.DATABASE_URL); assert.equal(env.CI, 'true');
  assert.equal(env.npm_config_registry, 'registry'); assert.equal(env.PATH, '/bin');
  for (const key of ['VERCEL_ENV', 'VERCEL_OIDC_TOKEN', 'STRIPE_SECRET_KEY', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'PRIVATE_BLOB_READ_WRITE_TOKEN'])
    assert.equal(env[key], undefined);
});

test('install is a bounded per-worktree npm ci with dev tools and reviewed generation only', () => {
  const root = mkdtempSync(join(tmpdir(), 'work-install-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { postinstall: 'prisma generate' } }));
    const calls = [], output = [];
    installWorktree(['--offline'], root, (command, args, opts) => { calls.push({ command, args, opts }); return { status: 0 }; }, s => output.push(s));
    assert.deepEqual(calls[0].args, ['ci', '--include=dev', '--offline']); assert.equal(calls[0].command, 'npm');
    assert.equal(calls[0].opts.cwd, root); assert.equal(calls[0].opts.timeout, 600000); assert.ok(!calls[0].opts.shell);
    assert.ok(output.at(-1).includes('no feature acceptance'));
    assert.throws(() => installWorktree(['--ignore-scripts'], root), /Usage/);
    symlinkSync('/shared-tree', join(root, 'node_modules'));
    assert.throws(() => installWorktree([], root), /never mutate the shared target/);
    rmSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { postinstall: 'prisma migrate deploy' } }));
    assert.throws(() => installWorktree([], root), /Review changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed, interrupted and timed out install never claims setup passed', () => {
  const root = mkdtempSync(join(tmpdir(), 'work-install-failure-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { postinstall: 'prisma generate' } }));
    for (const result of [{ status: 1 }, { status: null, signal: 'SIGKILL' }, { error: new Error('timeout') }]) {
      const output = [];
      assert.throws(() => installWorktree([], root, () => result, s => output.push(s)), /No passing setup evidence/);
      assert.ok(!output.some(s => s.includes('ready')));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
