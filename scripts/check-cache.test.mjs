import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeFingerprint, BUILD_PATHSPEC, recordName, hasPassed, markPassed } from './check-cache.mjs';

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'check-cache-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.ts'), 'one\n');
  git('add', '.'); git('commit', '-qm', 'base');
  return dir;
}

function inRepo(dir, fn) {
  const cwd = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(cwd); }
}

test('fingerprint changes with any edit, new file or staged change, and returns when undone', () => {
  const dir = scratchRepo();
  try {
    inRepo(dir, () => {
      const clean = codeFingerprint();
      writeFileSync('a.ts', 'two\n');
      const edited = codeFingerprint();
      assert.notEqual(edited, clean);
      writeFileSync('a.ts', 'one\n');
      assert.equal(codeFingerprint(), clean);
      writeFileSync('new.ts', 'x\n');
      const added = codeFingerprint();
      assert.notEqual(added, clean);
      writeFileSync('new.ts', 'y\n');
      assert.notEqual(codeFingerprint(), added, 'untracked content counts, not just its name');
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build fingerprint ignores tests, browser specs and docs but not source', () => {
  const dir = scratchRepo();
  try {
    inRepo(dir, () => {
      const before = codeFingerprint(BUILD_PATHSPEC);
      execFileSync('mkdir', ['-p', 'tests', 'e2e', 'docs']);
      writeFileSync('tests/x.test.ts', 't\n'); writeFileSync('e2e/x.spec.ts', 'e\n'); writeFileSync('docs/x.md', 'd\n');
      assert.equal(codeFingerprint(BUILD_PATHSPEC), before);
      writeFileSync('a.ts', 'changed\n');
      assert.notEqual(codeFingerprint(BUILD_PATHSPEC), before);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a record exists only after a pass and is specific to command and code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'records-'));
  try {
    const name = recordName([['npm', 'run', 'lint']], 'f1');
    assert.equal(hasPassed(name, dir), false);
    markPassed(name, 'lint', dir);
    assert.equal(hasPassed(name, dir), true);
    assert.equal(hasPassed(recordName([['npm', 'run', 'lint']], 'f2'), dir), false);
    assert.equal(hasPassed(recordName([['npm', 'run', 'typecheck']], 'f1'), dir), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
