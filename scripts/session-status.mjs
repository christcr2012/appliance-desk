// Read-only planning. Supplied deployment observations are not acceptance evidence.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const START = '<!-- release-acceptance:start -->';
const END = '<!-- release-acceptance:end -->';
const states = new Set(['PENDING', 'PASSED', 'BLOCKED']);

export function readQueue(text) {
  if (text.split(START).length !== 2 || text.split(END).length !== 2) {
    throw new Error('Exactly one release acceptance block is required in the authoritative ledger.');
  }
  const body = text.split(START)[1].split(END)[0].trim();
  const match = /^```json\s*\n([\s\S]*?)\n```$/.exec(body);
  if (!match) throw new Error('Release acceptance block must contain one JSON array.');
  const rows = JSON.parse(match[1]);
  if (!Array.isArray(rows)) throw new Error('Release acceptance queue must be an array.');
  const ids = new Set();
  for (const row of rows) {
    if (!row || !/^[A-Z0-9][A-Z0-9-]{0,63}$/.test(row.id) || ids.has(row.id)) throw new Error('Invalid or duplicate acceptance ID.');
    ids.add(row.id);
    if (!SHA.test(row.requiredRevision) || !states.has(row.status)) throw new Error(`Invalid revision/status: ${row.id}`);
    if (!Number.isSafeInteger(row.priority) || row.priority < 1) throw new Error(`Invalid priority: ${row.id}`);
    for (const key of ['task', 'procedure', 'gates', 'lastEvidence']) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 1200) throw new Error(`Missing/bounded ${key}: ${row.id}`);
    }
    if (!Array.isArray(row.dependsOn) || row.dependsOn.some(id => typeof id !== 'string') || new Set(row.dependsOn).size !== row.dependsOn.length) throw new Error(`Invalid dependencies: ${row.id}`);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Acceptance dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const row = rows.find(item => item.id === id);
    for (const dep of row.dependsOn) {
      if (!ids.has(dep)) throw new Error(`Unknown acceptance dependency: ${dep}`);
      visit(dep);
    }
    visiting.delete(id); visited.add(id);
  }
  for (const row of rows) visit(row.id);
  return rows;
}

export function planQueue(rows, observation, isAncestor) {
  const { main, live, deployed, deploymentState } = observation;
  for (const [name, sha] of Object.entries({ main, live, deployed })) {
    if (sha !== null && sha !== undefined && !SHA.test(sha)) throw new Error(`Use an exact full ${name} SHA.`);
  }
  const ready = deploymentState === 'READY' && main && live && deployed
    && isAncestor(live, main) === true && isAncestor(deployed, live) === true;
  const included = row => ready && isAncestor(row.requiredRevision, deployed) === true;
  return [...rows].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(row => {
    let disposition;
    if (!ready) disposition = 'VERIFY_DEPLOYMENT';
    else if (!included(row)) disposition = row.status === 'PASSED' ? 'RECHECK_AFTER_ROLLBACK' : 'WAIT_RELEASE_OR_FETCH_HISTORY';
    else if (row.status === 'PASSED') disposition = 'RECORDED_PASS';
    else if (row.status === 'BLOCKED') disposition = 'RECHECK_EXTERNAL_GATE';
    else if (row.dependsOn.some(id => { const dep = rows.find(x => x.id === id); return dep.status !== 'PASSED' || !included(dep); })) disposition = 'WAIT_ACCEPTANCE_DEPENDENCY';
    else disposition = 'DEPLOYED_CANDIDATE_CHECK_GATES';
    return { ...row, disposition };
  });
}

function git(root, ...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

export function run(root, args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--deployed', '--state', '--latest-pr', '--limit'].includes(flag) || flags[flag] !== undefined || !args[i + 1]) throw new Error('Usage: session-status.mjs [--deployed FULL_SHA --state READY] [--latest-pr NUMBER] [--limit NUMBER]');
    flags[flag] = args[i + 1];
  }
  if (Boolean(flags['--deployed']) !== Boolean(flags['--state'])) throw new Error('Supply both deployed SHA and observed deployment state.');
  if (flags['--state'] && !['READY', 'BUILDING', 'ERROR', 'CANCELED', 'UNKNOWN'].includes(flags['--state'])) throw new Error('Invalid deployment state.');
  const policy = JSON.parse(readFileSync(resolve(root, 'docs/session-policy.json'), 'utf8'));
  if (!/^[\w.-]+\/[\w.-]+$/.test(policy.repository) || !/^docs\/[\w/.-]+\.md$/.test(policy.ledger) || policy.ledger.includes('..')) throw new Error('Invalid repository/ledger policy.');
  const rows = readQueue(readFileSync(resolve(root, policy.ledger), 'utf8'));
  const observation = {
    main: git(root, 'rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'),
    live: git(root, 'rev-parse', '--verify', 'refs/remotes/origin/live^{commit}'),
    deployed: flags['--deployed'] || null, deploymentState: flags['--state'] || 'UNKNOWN'
  };
  const ancestor = (a, b) => {
    if (a === b) return true;
    if (!git(root, 'cat-file', '-t', a) || !git(root, 'cat-file', '-t', b)) return null;
    return git(root, 'merge-base', '--is-ancestor', a, b) !== null;
  };
  const plan = planQueue(rows, observation, ancestor);
  const limit = flags['--limit'] === undefined ? 10 : Number(flags['--limit']);
  if (flags['--limit'] !== undefined && (!/^\d+$/.test(flags['--limit']) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) throw new Error('Limit must be an integer from 1 to 1000.');
  const active = plan.filter(row => row.disposition !== 'RECORDED_PASS');
  const lines = [`Repository: ${policy.repository}`, `Read: ${policy.instructions}`, `Ledger: ${policy.ledger}`,
    `main=${observation.main || 'UNKNOWN'} live=${observation.live || 'UNKNOWN'}`,
    `Observed production=${observation.deployed || 'UNKNOWN'} state=${observation.deploymentState}`,
    `main/live/READY deployment match: ${Boolean(observation.main && observation.main === observation.live && observation.live === observation.deployed && observation.deploymentState === 'READY')}`,
    'Fetch refs first. Independently verify production provenance; supplied observations are not attestation.',
    'Candidates need existing authorization, fixture isolation and cleanup. This command never runs provider tests or releases.'];
  if (flags['--latest-pr']) {
    if (!/^\d+$/.test(flags['--latest-pr'])) throw new Error('Latest PR must be an integer.');
    lines.push(`Latest observed PR: #${Number(flags['--latest-pr'])} (informational only; no session PR quota or numeric boundary).`);
  }
  lines.push('PR work unit = one whole predefined batch subsection (such as H-3 or B-5). Technical slices, functions, tools, UI wiring, guards and packet tasks do not count separately. Partial subsection = zero completed batch subsections.');
  lines.push(`Queue: ${plan.length} total; ${plan.length - active.length} recorded passes; ${active.length} tasks to reconsider.`);
  for (const row of active.slice(0, limit)) lines.push(`${row.priority}. ${row.id} ${row.disposition}: ${row.task}`, `   Procedure: ${row.procedure}; gates: ${row.gates}`, `   Last evidence: ${row.lastEvidence}`);
  if (active.length > limit) lines.push(`${active.length - limit} additional tasks are in ${policy.ledger}; use --limit ${Math.min(active.length, 1000)} or read the queue directly. Nothing is removed or marked passed.`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run(resolve(fileURLToPath(new URL('..', import.meta.url))), process.argv.slice(2))); }
  catch (error) { console.error(`Session status: ${error.message}`); process.exitCode = 1; }
}
