#!/usr/bin/env node
// "Already passed for this exact code" records for local checks (2026-10-09, from Sol's feedback: the pre-push
// gate repeated checks preflight had just run, and sandbox sessions that expire mid-run restarted everything).
//
// A record is a small file under the checkout's own git directory (never committed, never shared between
// checkouts). Its name combines the exact command and a fingerprint of the code: every tracked file's content,
// untracked file, mode and symlink identity. Stage/commit representations do not change the fingerprint;
// actual file changes do. A runtime/command-specific record ensures that
// a record can only ever skip a check that already passed on byte-identical code. `--fresh` ignores records.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });

/**
 * Fingerprint of the working tree for the given git pathspec (default: everything).
 * Hash actual files, not index/diff representations: staging and committing identical
 * bytes must not invalidate a pass. Include paths, executable bits, deletions and
 * symlink identities. Never follow a symlink out of the checkout.
 */
export function codeFingerprint(pathspec = ['.']) {
  const hash = createHash('sha256');
  if (git(['ls-files', '-u', '--', ...pathspec]).trim()) throw new Error('Resolve unmerged files before recording checks.');
  const paths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...pathspec])
    .split('\0').filter(Boolean))].sort();
  for (const file of paths) {
    let stat;
    try { stat = lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Unsupported check input: ' + file);
    const kind = stat.isSymbolicLink() ? 'link' : (stat.mode & 0o111 ? 'executable' : 'file');
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file);
    hash.update(JSON.stringify([file, kind, bytes.length]) + '\0');
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/** Files that can change what `next build` produces (tests, browser specs and docs do not). */
export const BUILD_PATHSPEC = ['.', ':(exclude)tests', ':(exclude)e2e', ':(exclude)docs', ':(exclude)*.md'];

export function recordDir() {
  return git(['rev-parse', '--git-path', 'appliance-checks']).trim();
}

export function recordName(command, fingerprint, extra = '') {
  return createHash('sha256').update(JSON.stringify([command, extra])).update(fingerprint).digest('hex').slice(0, 40);
}

export function hasPassed(name, dir = recordDir()) {
  return existsSync(join(dir, name));
}

export function markPassed(name, detail = '', dir = recordDir()) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${new Date().toISOString()} ${detail}\n`);
}

/** Build reuse: the stored value must match both the build-relevant fingerprint and the current .next/BUILD_ID. */
export function buildIsCurrent(key, dir = recordDir()) {
  const record = join(dir, 'next-build');
  if (!existsSync(record) || !existsSync('.next/BUILD_ID')) return false;
  return readFileSync(record, 'utf8').trim() === `${key} ${readFileSync('.next/BUILD_ID', 'utf8').trim()}`;
}

export function markBuild(key, dir = recordDir()) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'next-build'), `${key} ${readFileSync('.next/BUILD_ID', 'utf8').trim()}\n`);
}
