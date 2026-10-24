import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checksPass, denverDay } from './promote-live.mjs';

export function eligibleTestingRun(event, repository) {
  const r = event.workflow_run;
  return r?.name === 'CI' && r.event === 'push' && r.head_branch === 'main' &&
    r.head_repository?.full_name === repository && r.conclusion === 'success' &&
    /^[a-f0-9]{40}$/.test(r.head_sha ?? '');
}

export async function run() {
  const repo = 'christcr2012/appliance-desk';
  if (process.env.GITHUB_REPOSITORY !== repo || !process.env.GH_TOKEN ||
      process.env.GITHUB_EVENT_NAME !== 'workflow_run') throw Error('Trusted checked-main event required');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!eligibleTestingRun(event, repo)) throw Error('Not a successful CI push for this repository main');
  const candidate = event.workflow_run.head_sha;
  const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const remoteHead = branch => git(['ls-remote', 'origin', 'refs/heads/' + branch]).split(/\s+/)[0];
  const marker = 'testing-promotion/' + denverDay();
  if (git(['ls-remote', '--tags', 'origin', 'refs/tags/' + marker])) { console.log('Testing build allowance already used today.'); return; }
  if (remoteHead('main') !== candidate) { console.log('Superseded checked candidate; testing unchanged.'); return; }
  const runs = [];
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/commits/${candidate}/check-runs?filter=latest&per_page=100&page=${page}`, {
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
  if (!checksPass(runs, ['ci', 'release-policy'], candidate)) throw Error('Exact candidate checks are not green');
  git(['fetch', '--no-tags', 'origin', 'main', 'testing']);
  const previous = remoteHead('testing');
  if (!/^[a-f0-9]{40}$/.test(previous)) throw Error('Testing branch must be provisioned first');
  if (previous === candidate) return;
  git(['merge-base', '--is-ancestor', previous, candidate]);
  if (remoteHead('main') !== candidate || remoteHead('testing') !== previous) throw Error('Release refs changed; refusing stale promotion');
  // No force: a racing incompatible update is refused by GitHub.
  git(['push', '--atomic', 'origin', candidate + ':refs/heads/testing', candidate + ':refs/tags/' + marker]);
  if (remoteHead('testing') !== candidate) throw Error('Testing promotion read-back failed');
  console.log('Testing advanced to checked main ' + candidate);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
