import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function denverDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}

export function checksPass(runs, required, sha) {
  return required.every(name => {
    const run = runs.filter(r => r.name === name && r.app?.slug === 'github-actions' &&
      r.head_sha === sha).sort((a, b) => b.id - a.id)[0];
    return run?.status === 'completed' && run.conclusion === 'success';
  });
}

export function decide({ main, live, alreadyToday, ancestor, green }) {
  if (![main, live].every(s => /^[a-f0-9]{40}$/.test(s))) throw Error('Invalid commit identity');
  if (alreadyToday || main === live) return 'skip';
  if (!ancestor) throw Error('live has diverged; refusing to rewrite history');
  if (!green) throw Error('Main checks are missing, pending or failed');
  return 'promote';
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function run(policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'))) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (process.env.GITHUB_EVENT_NAME !== 'schedule' || process.env.GITHUB_REF !== 'refs/heads/main' ||
      repo !== policy.repository || !process.env.GH_TOKEN) throw Error('Scheduled owner main only');
  git(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/live:refs/remotes/origin/live']);
  const main = git(['rev-parse', 'origin/main']);
  const live = git(['rev-parse', 'origin/live']);
  if (git(['rev-parse', 'HEAD']) !== main) throw Error('Main moved after checkout; retry tomorrow');
  const marker = 'live-promotion/' + denverDay();
  const tagged = () => git(['ls-remote', '--tags', 'origin', 'refs/tags/' + marker]) !== '';
  if (tagged() || main === live) { console.log('No promotion needed today'); return; }
  let ancestor = false;
  try { git(['merge-base', '--is-ancestor', live, main]); ancestor = true; } catch { /* fail closed */ }
  const runs = [];
  // Paginate; never silently ignore checks after page one.
  for (let page = 1; page <= 20; page++) {
    const response = await fetch('https://api.github.com/repos/' + repo + '/commits/' + main +
      '/check-runs?filter=latest&per_page=100&page=' + page, {
      headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN,
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw Error('Cannot verify main checks');
    const payload = await response.json();
    if (!Array.isArray(payload.check_runs)) throw Error('Invalid check response');
    runs.push(...payload.check_runs);
    if (runs.length >= payload.total_count) break;
    if (page === 20 || !payload.check_runs.length) throw Error('Incomplete check inventory');
  }
  const action = decide({ main, live, alreadyToday: tagged(), ancestor,
    green: checksPass(runs, policy.requiredChecks, main) });
  if (action !== 'promote') return;
  const remoteHead = ref => git(['ls-remote', 'origin', 'refs/heads/' + ref]).split(/\s+/)[0];
  if (remoteHead('main') !== main || remoteHead('live') !== live || tagged())
    throw Error('Remote changed; retry tomorrow');
  // A rerun or racing job cannot advance live twice in a Denver calendar day.
  // Atomic push refuses both updates if the marker already exists or live diverges.
  git(['push', '--atomic', 'origin', main + ':refs/heads/live', main + ':refs/tags/' + marker]);
  if (remoteHead('live') !== main || !tagged()) throw Error('Promotion read-back failed');
  console.log('Promoted checked main to live for ' + denverDay());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
