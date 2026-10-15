import { execFileSync } from 'node:child_process';

function run(root, ...args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

export function summarizeCheckpoint(input) {
  const paths = input.paths.filter(Boolean);
  const staged = paths.filter(row => row[0] !== ' ' && row[0] !== '?');
  const unstaged = paths.filter(row => row[1] !== ' ' || row.startsWith('??'));
  const warnings = [];
  if (input.branch === 'main' && paths.length)
    warnings.push('Work is dirty on main. Preserve it before changing branches.');
  if (!input.originMain)
    warnings.push('No fetched origin/main. Fetch and reconcile; local work is not proof of current main.');
  else if (input.head !== input.originMain && input.behind > 0)
    warnings.push('Local branch is behind origin/main; reconcile without discarding working files.');
  if (paths.length >= 8 && !input.commitsAhead)
    warnings.push('Broad uncommitted integration: create a recoverable checkpoint and verify coherent boundaries.');
  if (input.conflicts > 0)
    warnings.push('Unresolved merge conflicts: preserve edits and reconcile before verification.');
  return {
    branch: input.branch, head: input.head,
    originMain: input.originMain || 'NOT_FETCHED',
    commitsAheadOfOriginMain: input.commitsAhead,
    commitsBehindOriginMain: input.behind,
    changedPathCount: paths.length,
    stagedPathCount: staged.length,
    unstagedPathCount: unstaged.length,
    conflicts: input.conflicts,
    paths,
    warnings,
    next: [
      'Reconcile current main, open/concurrent PRs, production revision and the acceptance ledger.',
      'Pick the current incomplete whole approved subsection and list every remaining consumer.',
      'On a command failure, inspect its exit/logs and attempt one authorized targeted remedy; do not restart the whole workflow.',
      'Run focused proof, then required broad verification on the exact head; record failed or unrun gates honestly.',
      'Commit coherent recoverable work on the existing implementation branch, and use its implementation PR for documentation.',
      'Review/merge only when all required exact-head gates pass. Recheck deployed acceptance independently.',
    ],
    evidenceScope: 'Read-only local Git checkpoint. No CI, merge, deployment, owner, Stripe, or professional acceptance is inferred.',
  };
}

export function workCheckpoint(root, git = run) {
  const head = git(root, 'rev-parse', 'HEAD');
  const branch = git(root, 'branch', '--show-current');
  let originMain = '';
  try { originMain = git(root, 'rev-parse', '--verify', 'refs/remotes/origin/main'); }
  catch { /* New or disconnected checkout; report missing ref, never invent it. */ }
  const paths = git(root, 'status', '--porcelain=v1', '--untracked-files=all')
    .split('\n').filter(Boolean);
  let commitsAhead = 0;
  let behind = 0;
  if (originMain) {
    const relation = git(root, 'rev-list', '--left-right', '--count', 'origin/main...HEAD')
      .split(/\s+/).map(Number);
    behind = relation[0] ?? 0;
    commitsAhead = relation[1] ?? 0;
  }
  const conflicts = git(root, 'ls-files', '-u').split('\n').filter(Boolean).length;
  return summarizeCheckpoint({
    branch, head, originMain, paths, commitsAhead, behind, conflicts,
  });
}
