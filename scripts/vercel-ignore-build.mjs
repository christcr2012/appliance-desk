#!/usr/bin/env node
// Vercel "Ignored Build Step" (vercel.json → ignoreCommand). Exit 0 = skip this deployment, exit 1 = build it.
//
// Why (Chris, 2026-10-09: "How do we get these costs down???"): Vercel bills every build. On Oct 9 it built the
// site 84 times in 16 hours, most of them for pushes that changed only docs, tests or CI scripts — files the live
// site never uses. GitHub Actions already builds and tests every PR for free, so a Vercel build is only worth paying
// for when something the site is made from changed.
//
// Rule: build when any file changed since this branch's last successful Vercel deployment could change the site;
// skip when every changed file is in NON_APP. Transfer branches never build. Anything uncertain (no earlier
// deployment, missing base commit, git error, empty diff) builds.
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
export function decide({ branch = '', previousSha = '', changed = null }) {
  if (branch.startsWith('transfer/')) return { build: false, reason: 'transfer branches only carry upload parts' };
  if (!previousSha) return { build: true, reason: 'no earlier deployment of this branch to compare with' };
  if (changed === null) return { build: true, reason: `could not compare with ${previousSha}` };
  if (!changed.length) return { build: true, reason: 'no file differences found; building to be safe' };
  const app = changed.find(isAppFile);
  if (app) return { build: true, reason: `site file changed (${app})` };
  return { build: false, reason: `only docs/tests/CI files changed since ${previousSha}; the site would be identical` };
}

function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? '';
  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA ?? '';
  let changed = null;
  if (previousSha && !branch.startsWith('transfer/')) {
    try {
      execFileSync('git', ['cat-file', '-e', `${previousSha}^{commit}`], { stdio: 'ignore' });
      changed = execFileSync('git', ['diff', '--name-only', previousSha, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch { changed = null; }
  }
  const { build, reason } = decide({ branch, previousSha, changed });
  console.log(`${build ? 'Building' : 'Skipping build'}: ${reason}.`);
  process.exit(build ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
