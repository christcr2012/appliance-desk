import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checksPass, denverDay } from './promote-live.mjs';

// Evening testing release (owner direction 2026-10-24): once per Denver day the
// newest fully checked main commit goes to the testing app. That night's live
// release then ships exactly that version, and only if the testing app built it.

export function authorizedTestingInvocation(env, repository) {
  if (env.GITHUB_REPOSITORY !== repository || !env.GH_TOKEN || env.GITHUB_REF !== 'refs/heads/main') return false;
  if (env.GITHUB_EVENT_NAME === 'schedule') return true;
  // Extra same-day testing builds are the owner's call only.
  return env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_ACTOR === 'christcr2012' && env.GITHUB_TRIGGERING_ACTOR === 'christcr2012';
}

/** First commit (newest first) whose required checks all passed. */
export function newestGreen(candidates, runsBySha, required) {
  return candidates.find(sha => checksPass(runsBySha[sha] ?? [], required, sha)) ?? null;
}

async function checkRuns(repo, sha) {
  const runs = [];
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`, {
      headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('Cannot verify candidate checks');
    const body = await response.json();
    if (!Array.isArray(body.check_runs)) throw Error('Invalid checks response');
    runs.push(...body.check_runs);
    if (runs.length >= body.total_count) break;
    if (page === 20 || !body.check_runs.length) throw Error('Incomplete checks inventory');
  }
  return runs;
}

export async function run({ repo = 'christcr2012/appliance-desk', required = ['ci', 'release-policy'] } = {}) {
  if (!authorizedTestingInvocation(process.env, repo))
    throw Error('Scheduled run or the owner only');
  const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const remoteHead = branch => git(['ls-remote', 'origin', 'refs/heads/' + branch]).split(/\s+/)[0];
  const scheduled = process.env.GITHUB_EVENT_NAME === 'schedule';
  const marker = 'testing-promotion/' + denverDay() + (scheduled ? '' : '-owner-' + Date.now());
  if (scheduled && git(['ls-remote', '--tags', 'origin', 'refs/tags/' + marker])) {
    console.log('Testing build allowance already used today.'); return;
  }
  git(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/testing:refs/remotes/origin/testing']);
  const previous = git(['rev-parse', 'origin/testing']);
  if (!/^[a-f0-9]{40}$/.test(previous)) throw Error('Testing branch must be provisioned first');
  // Newest first along main's merge line, never further back than testing.
  const line = git(['rev-list', '--first-parent', '--max-count=30', 'origin/main']).split('\n').filter(Boolean);
  const stop = line.indexOf(previous);
  const candidates = stop === -1 ? line : line.slice(0, stop);
  if (!candidates.length) { console.log('Testing already has the newest main.'); return; }
  const runsBySha = {};
  for (const sha of candidates) runsBySha[sha] = await checkRuns(repo, sha);
  const candidate = newestGreen(candidates, runsBySha, required);
  if (!candidate) { console.log('No newer fully checked main commit; testing unchanged.'); return; }
  try { git(['merge-base', '--is-ancestor', previous, candidate]); }
  catch { throw Error('testing has diverged from main; refusing to rewrite it'); }
  if (remoteHead('testing') !== previous) throw Error('Testing changed during the run; refusing stale promotion');
  // No force: a racing incompatible update is refused by GitHub.
  git(['push', '--atomic', 'origin', candidate + ':refs/heads/testing', candidate + ':refs/tags/' + marker]);
  if (remoteHead('testing') !== candidate) throw Error('Testing promotion read-back failed');
  console.log('Testing advanced to checked main ' + candidate);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
