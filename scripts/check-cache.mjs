#!/usr/bin/env node
// "Already passed for this exact code" records for local checks (2026-10-09, from Sol's feedback: the pre-push
// gate repeated checks preflight had just run, and sandbox sessions that expire mid-run restarted everything).
//
// A record is a small file under the checkout's own git directory (never committed, never shared between
// checkouts). Its name combines the exact command and a fingerprint of the code: every tracked file's content,
// every uncommitted edit and every new untracked file. Any change to the code produces a new fingerprint, so
// a record can only ever skip a check that already passed on byte-identical code. `--fresh` ignores records.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });

/**
 * Fingerprint of the working tree for the given git pathspec (default: everything).
 * Tracked content comes from the index entries plus the uncommitted diff; untracked files are hashed by git.
 */
export function codeFingerprint(pathspec = ['.']) {
  const hash = createHash('sha256');
  hash.update(git(['ls-files', '-s', '--', ...pathspec]));
  hash.update(git(['diff', 'HEAD', '--binary', '--', ...pathspec]));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspec]).split('\0').filter(Boolean);
  if (untracked.length) {
    hash.update(untracked.join('\0'));
    hash.update(git(['hash-object', '--stdin-paths'], untracked.join('\n') + '\n'));
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
