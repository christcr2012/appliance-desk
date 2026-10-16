// Read-only planning. Supplied deployment observations are not acceptance evidence.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planReleaseAlert, releaseAlertLines } from './release-needed.mjs';

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

/**
 * When the roadmap advances, older completed engineering milestones must not
 * vanish from the permanent release-acceptance queue. This checks coverage,
 * NOT acceptance; it creates no provider operations and never promotes PASSED.
 * W-26 can be set active before any W-26 implementation is merged.
 */
export function missingRoadmapAcceptance(rows, activeExecution) {
  const milestones = ['W-23', 'W-24', 'W-25'];
  const active = milestones.indexOf(activeExecution);
  const through = activeExecution === 'W-26' ? milestones.length - 1 : active;
  if (through < 0) return [];
  return milestones.slice(0, through + 1)
    .filter(id => !rows.some(row => row.id.startsWith(id.replace('-', '') + '-')));
}

/** Deployment provenance must be checked even when there are no queue rows. */
export function deploymentReady({ main, live, deployed, deploymentState }, isAncestor) {
  return deploymentState === 'READY' && [main, live, deployed].every(sha => SHA.test(sha || '')) &&
    isAncestor(live, main) === true && isAncestor(deployed, live) === true;
}

export function planQueue(rows, observation, isAncestor) {
  const { main, live, deployed } = observation;
  for (const [name, sha] of Object.entries({ main, live, deployed })) {
    if (sha !== null && sha !== undefined && !SHA.test(sha)) throw new Error(`Use an exact full ${name} SHA.`);
  }
  const ready = deploymentReady(observation, isAncestor);
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

/** Bind accounting to every queue field and planner disposition, not just identity. */
export function acceptanceSnapshot(plan) {
  const canonical = [...plan].sort((a, b) => a.id.localeCompare(b.id)).map(row =>
    Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Actionable acceptance is displayed before waiting work, independently of main lag. */
export function acceptanceSummary(plan, limit = 10) {
  const action = plan.filter(row => ['DEPLOYED_CANDIDATE_CHECK_GATES', 'RECHECK_EXTERNAL_GATE'].includes(row.disposition));
  const waiting = plan.filter(row => !['DEPLOYED_CANDIDATE_CHECK_GATES', 'RECHECK_EXTERNAL_GATE', 'RECORDED_PASS'].includes(row.disposition));
  const passed = plan.length - action.length - waiting.length;
  const lines = [`Acceptance first: ${action.length} deployed tasks to act on/recheck; ${waiting.length} waiting/verification tasks; ${passed} usable deployed passes.`,
    'Main ahead of live does not defer included checks. Listing a task is NOT executing it.',
    'Acceptance snapshot: ' + acceptanceSnapshot(plan)];
  for (const [label, rows] of [['ACT OR RECHECK GATES NOW', action], ['WAITING OR VERIFY SPECIFIC PREREQUISITE', waiting]]) {
    lines.push(label + ':');
    for (const row of rows.slice(0, limit)) lines.push(`${row.priority}. ${row.id} ${row.disposition}: ${row.task}`,
      `   Procedure: ${row.procedure}; gates: ${row.gates}`, `   Last evidence: ${row.lastEvidence}`);
    if (rows.length > limit) lines.push(`${rows.length - limit} additional tasks in this group; use --limit ${Math.min(plan.length, 1000)} or read the full ledger.`);
  }
  return lines;
}

/** Completeness/freshness check for a temporary handoff extract; never proof or permission. */
export function reviewAcceptance(plan, observation, report, isAncestor = () => null) {
  if (!deploymentReady(observation, isAncestor) ||
      plan.some(row => row.disposition === 'VERIFY_DEPLOYMENT'))
    throw new Error('Acceptance review requires verified READY deployment data; otherwise leave an incomplete checkpoint.');
  if (!report || report.snapshot !== acceptanceSnapshot(plan) || report.deployed !== observation.deployed || report.deploymentState !== observation.deploymentState ||
      !Array.isArray(report.tasks) || report.tasks.length > plan.length)
    throw new Error('Acceptance review needs the current deployed revision/state and bounded tasks.');
  const bounded = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1200;
  const seen = new Set();
  for (const entry of report.tasks) {
    const row = plan.find(item => item.id === entry?.id);
    if (!row || seen.has(entry.id) || entry.requiredRevision !== row.requiredRevision || entry.disposition !== row.disposition)
      throw new Error('Unknown, duplicate or stale acceptance review task.');
    seen.add(entry.id);
    if (!bounded(entry.evidence)) throw new Error('Acceptance review needs sanitized task evidence.');
    if (entry.outcome === 'PERFORMED') {
      if (!['DEPLOYED_CANDIDATE_CHECK_GATES', 'RECHECK_EXTERNAL_GATE'].includes(row.disposition) ||
          !['PASS', 'FAIL'].includes(entry.result) || entry.result === 'FAIL' && !bounded(entry.nextAction))
        throw new Error('Performed acceptance needs deployed eligibility, result and failure recovery.');
    } else if (entry.outcome === 'DEFERRED') {
      if (row.disposition === 'RECORDED_PASS' || !['prerequisite', 'remedy', 'nextAction'].every(key => bounded(entry[key])))
        throw new Error('Deferral needs the specific prerequisite, investigated remedy and next action.');
    } else if (entry.outcome !== 'REUSED' || row.disposition !== 'RECORDED_PASS') {
      throw new Error('Acceptance review outcome must be PERFORMED, DEFERRED or a recorded REUSED pass.');
    }
  }
  const missing = plan.filter(row => row.disposition !== 'RECORDED_PASS' && !seen.has(row.id));
  if (missing.length) throw new Error('Unreviewed acceptance tasks: ' + missing.map(row => row.id).join(', '));
  return 'Acceptance accounting checked for this snapshot; evidence truth, authorization and required workflow remain independently reviewed.';
}

function git(root, ...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

export function run(root, args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--deployed', '--state', '--latest-pr', '--limit', '--acceptance-review'].includes(flag) || flags[flag] !== undefined || !args[i + 1]) throw new Error('Usage: session-status.mjs [--deployed FULL_SHA --state READY] [--latest-pr NUMBER] [--limit NUMBER] [--acceptance-review PATH]');
    flags[flag] = args[i + 1];
  }
  if (Boolean(flags['--deployed']) !== Boolean(flags['--state'])) throw new Error('Supply both deployed SHA and observed deployment state.');
  if (flags['--state'] && !['READY', 'BUILDING', 'ERROR', 'CANCELED', 'UNKNOWN'].includes(flags['--state'])) throw new Error('Invalid deployment state.');
  const policy = JSON.parse(readFileSync(resolve(root, 'docs/session-policy.json'), 'utf8'));
  if (!/^[\w.-]+\/[\w.-]+$/.test(policy.repository) || !/^docs\/[\w/.-]+\.md$/.test(policy.ledger) || policy.ledger.includes('..')) throw new Error('Invalid repository/ledger policy.');
  const rows = readQueue(readFileSync(resolve(root, policy.ledger), 'utf8'));
  const roadmap = JSON.parse(readFileSync(resolve(root, 'docs/pr-cards/work-index.json'), 'utf8'));
  const missingScopes = missingRoadmapAcceptance(rows, roadmap.activeExecution);
  if (missingScopes.length)
    throw new Error('Missing deployed acceptance backlog for approved roadmap work: ' +
      missingScopes.join(', ') + '. Record PENDING tasks without inventing live proof.');

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
    'Fetch refs first. Independently verify production provenance; supplied observations are not attestation.',
    'Candidates need existing authorization, fixture isolation and cleanup. This command never runs provider tests or releases.'];
  lines.push(...releaseAlertLines(planReleaseAlert(plan, observation, ancestor)));
  lines.push(...acceptanceSummary(plan, limit));
  lines.push('Work selection after acceptance catch-up: finish confirmed gaps in original approved order; reconcile uncertain criteria once and retain exact source/test proof. If no eligible engineering remains, plan substantial NEW real-world completion using existing acceptance IDs. No production-line minimum applies to COMPLETION; old code, audits, isolated reads and reused passes count zero. Do not invent features or require an optional dependency to finish the standalone project.');
  if (flags['--acceptance-review']) {
    const raw = readFileSync(resolve(root, flags['--acceptance-review']), 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 262144) throw new Error('Acceptance review exceeds bounded size.');
    lines.push(reviewAcceptance(plan, observation, JSON.parse(raw), ancestor));
  } else lines.push('Acceptance accounting NOT CHECKED: use --acceptance-review PATH before new implementation and final handoff (or equivalent manual accounting).');
  if (flags['--latest-pr']) {
    if (!/^\d+$/.test(flags['--latest-pr'])) throw new Error('Latest PR must be an integer.');
    lines.push(`Latest observed PR: #${Number(flags['--latest-pr'])} (informational only; no session PR quota or numeric boundary).`);
  }
  lines.push('PR work unit = one whole predefined batch subsection (such as H-3 or B-5). Technical slices, functions, tools, UI wiring, guards and packet tasks do not count separately. Partial subsection = zero completed batch subsections.');
  lines.push(`Queue: ${plan.length} total; ${rows.filter(row => row.status === 'PASSED').length} recorded passes; ${active.length} tasks require planner consideration.`);

  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run(resolve(fileURLToPath(new URL('..', import.meta.url))), process.argv.slice(2))); }
  catch (error) { console.error(`Session status: ${error.message}`); process.exitCode = 1; }
}
