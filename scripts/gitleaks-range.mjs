#!/usr/bin/env node
// Restrict PR/push Gitleaks history to new commits; the separate project
// secret scanner still checks the complete checked-out working tree.
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const ZERO_SHA = /^0{40}$/;

function gitCommit(ref) {
  return execFileSync('git', ['rev-parse', '--verify', ref + '^{commit}'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}
function gitAncestor(older, newer) {
  return spawnSync('git', ['merge-base', '--is-ancestor', older, newer], {
    stdio: 'ignore'
  }).status === 0;
}
function checkedCommit(ref, resolveCommit) {
  const sha = resolveCommit(ref);
  if (!SHA.test(sha)) throw new Error('Git did not resolve a valid commit SHA');
  return sha;
}

/** Return validated commit IDs plus exclusion markers for --log-opts. */
export function selectGitleaksLogOpts(env, { resolveCommit = gitCommit, isAncestor = gitAncestor } = {}) {
  const head = checkedCommit('HEAD', resolveCommit);
  switch (env.EVENT_NAME) {
    case 'pull_request': {
      if (!SHA.test(env.PR_BASE_SHA ?? '') || !SHA.test(env.PR_HEAD_SHA ?? '')) {
        throw new Error('Pull request is missing a valid base/head SHA; refusing to narrow the scan');
      }
      const base = checkedCommit(env.PR_BASE_SHA, resolveCommit);
      const prHead = checkedCommit(env.PR_HEAD_SHA, resolveCommit);
      // Exclude every commit already reachable from main, including merged main
      // work. Do not scan the checkout's synthetic PR merge or unrelated refs.
      return prHead === base ? prHead : prHead + ' ^' + base;
    }
    case 'push': {
      if (!SHA.test(env.PUSH_AFTER_SHA ?? '')) {
        throw new Error('Push is missing a valid after SHA; refusing to narrow the scan');
      }
      const after = checkedCommit(env.PUSH_AFTER_SHA, resolveCommit);
      if (after !== head) throw new Error('Checked-out commit is not the pushed commit');
      const before = env.PUSH_BEFORE_SHA ?? '';
      if (SHA.test(before) && !ZERO_SHA.test(before)) {
        try {
          const old = checkedCommit(before, resolveCommit);
          if (old !== after && isAncestor(old, after)) return after + ' ^' + old;
        } catch { /* Missing old commit: scan all history reachable from after. */ }
      }
      return after;
    }
    case 'workflow_dispatch': {
      const baseName = env.DISPATCH_BASE || 'main';
      if (!/^[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(baseName) ||
          baseName.includes('..') || baseName.endsWith('/')) {
        throw new Error('Invalid dispatch base branch');
      }
      try {
        const base = checkedCommit('refs/remotes/origin/' + baseName, resolveCommit);
        return base === head ? head : head + ' ^' + base;
      } catch { /* Missing base ref: audit all reachable history of this head. */ }
      return head;
    }
    case 'schedule':
      // Full history reachable from main, not every branch in the repository.
      return head;
    default:
      throw new Error('Unsupported event for Gitleaks scope');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log('log_opts=' + selectGitleaksLogOpts(process.env));
  } catch (error) {
    console.error('::error::Unable to determine safe Gitleaks scope: ' + error.message);
    process.exitCode = 1;
  }
}
