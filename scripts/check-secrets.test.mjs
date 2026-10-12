import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanWorkingTree } from './check-secrets.mjs';

test('new files get the same secret scan before staging, after staging and after commit; ignored env stays ignored', () => {
  const root = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root });
    git('init', '-q'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
    writeFileSync(join(root, '.gitignore'), '.env\n'); git('add', '.'); git('commit', '-qm', 'base');
    const planted = 'ghp_' + 'a'.repeat(40);
    writeFileSync(join(root, 'new.txt'), planted); writeFileSync(join(root, '.env'), planted);
    const before = scanWorkingTree(root);
    assert.equal(before.findings.length, 1); assert.equal(before.findings[0].file, 'new.txt');
    assert.ok(!before.files.includes('.env'));
    git('add', 'new.txt'); assert.deepEqual(scanWorkingTree(root), before);
    git('commit', '-qm', 'new'); assert.deepEqual(scanWorkingTree(root), before);
    const run = spawnSync(process.execPath, [resolve(import.meta.dirname, 'check-secrets.mjs')], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 1); assert.ok(!run.stderr.includes(planted), 'only redacted rule/path evidence');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('force-staged ignored files are scanned and forbidden key paths are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'secret-path-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), '.env\n'); writeFileSync(join(root, '.env'), 'local configuration');
    writeFileSync(join(root, 'certificate.pem'), 'private data');
    execFileSync('git', ['add', '-f', '.env'], { cwd: root });
    const { findings } = scanWorkingTree(root);
    assert.ok(findings.some(f => f.file === '.env' && f.rule.includes('environment')));
    assert.ok(findings.some(f => f.file === 'certificate.pem' && f.rule.includes('key/certificate')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an untracked symlink never reads or reports secrets from outside the checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'secret-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'external-secret-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(outside, 'external.txt'), 'ghp_' + 'b'.repeat(40));
    symlinkSync(join(outside, 'external.txt'), join(root, 'link'));
    assert.deepEqual(scanWorkingTree(root).findings, []);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
