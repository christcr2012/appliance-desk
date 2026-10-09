#!/usr/bin/env node
// Vercel "Ignored Build Step" (vercel.json → ignoreCommand). Exit 0 = skip this deployment, exit 1 = build it.
//
// Why (Chris, 2026-10-09: "How do we get these costs down???"): Vercel bills every build. On Oct 9 it built the
// site 84 times in 16 hours, most of them for pushes that changed only docs, tests or CI scripts — files the live
// site never uses. GitHub Actions already builds and tests every PR for free, so a Vercel build is only worth paying
// for when something the site is made from changed.
//
// Rule: build when any file changed since this branch's last successful Vercel deployment could change the site;
// skip when every changed file is in NON_APP. A new branch (no earlier deployment) is compared with the current tip
// of `main` instead — a straight tree comparison, so changes on `main` the branch lacks also count and make it build.
// Transfer branches never build. Anything uncertain (no comparison possible, git error, empty diff) builds.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Files the deployed site is never built from. Everything else (src, prisma, public, package files, next/vercel
// config, scripts used by `vercel-build`) builds.
const NON_APP = [
  /^docs\//, /\.md$/i, /^tests\//, /^e2e\//, /^\.github\//, /^\.githooks\//,
  /^scripts\/.*\.test\.mjs$/, /^playwright\.config\.ts$/, /^vitest\.config\.[cm]?[jt]s$/, /^\.gitleaksignore$/,
];

export const isAppFile = file => !NON_APP.some(pattern => pattern.test(file));

/** Returns { build: boolean, reason: string } from the branch, the previous deployed commit and the changed files. */
export function decide({ branch = '', previousSha = '', changed = null, environment = '' }) {
  if (branch.startsWith('transfer/')) return { build: false, reason: 'transfer branches only carry upload parts' };
  // Once Vercel's production branch is `live` (daily release, .github/workflows/release.yml), `main` would build as a
  // paid preview after every merge; GitHub Actions already builds and tests it for free.
  if (branch === 'main' && environment === 'preview') return { build: false, reason: 'main is released daily through the live branch' };
  if (!previousSha) return { build: true, reason: 'nothing to compare with (no earlier deployment, main unavailable)' };
  if (changed === null) return { build: true, reason: `could not compare with ${previousSha}` };
  if (!changed.length) return { build: true, reason: 'no file differences found; building to be safe' };
  const app = changed.find(isAppFile);
  if (app) return { build: true, reason: `site file changed (${app})` };
  return { build: false, reason: `only docs/tests/CI files changed since ${previousSha}; the site would be identical` };
}

function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? '';
  let previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA ?? '';
  let changed = null;
  if (!branch.startsWith('transfer/')) {
    try {
      if (previousSha) {
        execFileSync('git', ['cat-file', '-e', `${previousSha}^{commit}`], { stdio: 'ignore' });
      } else if (branch && branch !== 'main') {
        // New branch: fetch only the tip of main (public repository, shallow) and compare the two trees.
        execFileSync('git', ['fetch', '--quiet', '--depth=1', 'https://github.com/christcr2012/appliance-desk.git', 'main'],
          { stdio: 'ignore', timeout: 60_000 });
        previousSha = execFileSync('git', ['rev-parse', 'FETCH_HEAD'], { encoding: 'utf8' }).trim();
      }
      if (previousSha)
        changed = execFileSync('git', ['diff', '--name-only', previousSha, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch { changed = null; }
  }
  const { build, reason } = decide({ branch, previousSha, changed, environment: process.env.VERCEL_ENV ?? '' });
  console.log(`${build ? 'Building' : 'Skipping build'}: ${reason}.`);
  process.exit(build ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
