import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function denverDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}

export function denverMinute(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 +
    Number(parts.find(p => p.type === 'minute')?.value);
}

export function authorizedReleaseInvocation(env, repository, now = new Date()) {
  if (env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== 'refs/heads/main' || !env.GH_TOKEN) return false;
  if (env.GITHUB_EVENT_NAME === 'schedule') return true;
  // No default dispatch or automated production override; GitHub owner only.
  return env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_ACTOR === 'christcr2012' &&
    env.RECOVER_MISSED_DAILY === 'true' && denverMinute(now) >= 1;
}

export function checksPass(runs, required, sha) {
  return required.every(name => {
    const run = runs.filter(r => r.name === name && r.app?.slug === 'github-actions' &&
      r.head_sha === sha).sort((a, b) => b.id - a.id)[0];
    return run?.status === 'completed' && run.conclusion === 'success';
  });
}

export function checksFailed(runs, required, sha) {
  return required.some(name => {
    const run = runs.filter(r => r.name === name && r.app?.slug === 'github-actions' &&
      r.head_sha === sha).sort((a, b) => b.id - a.id)[0];
    return run?.status === 'completed' && run.conclusion !== 'success';
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

export async function run(policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8')),
  { attempts = 20, pause = () => new Promise(resolve => setTimeout(resolve, 30000)) } = {}) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!authorizedReleaseInvocation(process.env, policy.repository))
    throw Error('Scheduled or explicitly owner-recovered main only');
  const deadline = Date.now() + 10 * 60 * 1000;
  const marker = 'live-promotion/' + denverDay();
  const tagged = () => git(['ls-remote', '--tags', 'origin', 'refs/tags/' + marker]) !== '';
  const remoteHead = ref => git(['ls-remote', 'origin', 'refs/heads/' + ref]).split(/\s+/)[0];
  for (let attempt = 0; attempt < attempts && Date.now() < deadline; attempt++) {
    if (attempt) await pause();
    if (tagged()) { console.log('Already promoted today'); return; }
    git(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main',
      '+refs/heads/live:refs/remotes/origin/live']);
    const main = git(['rev-parse', 'origin/main']);
    const live = git(['rev-parse', 'origin/live']);
    if (tagged() || main === live) { console.log('No promotion needed today'); return; }
    let ancestor = false;
    try { git(['merge-base', '--is-ancestor', live, main]); ancestor = true; } catch { /* fail closed */ }
    const runs = [];
    // Paginate; never silently ignore checks after page one.
    for (let page = 1; page <= 20; page++) {
      const response = await fetch('https://api.github.com/repos/' + repo + '/commits/' + main +
        '/check-runs?filter=latest&per_page=100&page=' + page, {
        headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN,
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw Error('Cannot verify main checks');
      const payload = await response.json();
      if (!Array.isArray(payload.check_runs)) throw Error('Invalid check response');
      runs.push(...payload.check_runs);
      if (runs.length >= payload.total_count) break;
      if (page === 20 || !payload.check_runs.length) throw Error('Incomplete check inventory');
    }
    if (remoteHead('main') !== main || remoteHead('live') !== live) {
      console.log('Branches moved; refreshing release candidate'); continue;
    }
    if (checksFailed(runs, policy.requiredChecks, main)) throw Error('Required main check failed for ' + main);
    if (!checksPass(runs, policy.requiredChecks, main)) {
      console.log('Waiting for required checks on ' + main); continue;
    }
    const action = decide({ main, live, alreadyToday: tagged(), ancestor,
      green: checksPass(runs, policy.requiredChecks, main) });
    if (action !== 'promote') return;
    if (remoteHead('main') !== main || remoteHead('live') !== live || tagged())
      continue;
    // A rerun or racing job cannot advance live twice in a Denver calendar day.
    // Atomic push refuses both updates if the marker already exists or live diverges.
    git(['push', '--atomic', 'origin', main + ':refs/heads/live', main + ':refs/tags/' + marker]);
    if (remoteHead('live') !== main || !tagged()) throw Error('Promotion read-back failed');
    console.log('Promoted checked main to live for ' + denverDay());
    return;
  }
  throw Error('Release window exhausted; main kept moving or required checks stayed pending. live unchanged.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
