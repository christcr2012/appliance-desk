// Offline accounting for original real-world completion, never permission or attestation.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readQueue } from './session-status.mjs';

const SHA = /^[a-f0-9]{40}$/;
const APPROVED = new Set(['APPROVED', 'IN_PROGRESS', 'BLOCKED', 'MERGED', 'COMPLETE']);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;

/** Validate a newly completed delta; no card status or line count proves real acceptance. */
export function assessCompletionEvidence(plan, baseline, current, baselineIndex, currentIndex, planningQueue = baseline) {
  if (plan.workKind !== 'COMPLETION') throw Error('Completion evidence requires an explicit COMPLETION plan.');
  const units = index => new Set(index.cards.filter(card => APPROVED.has(card.status))
    .flatMap(card => card.units || [card.id]));
  const original = units(baselineIndex), approved = units(currentIndex);
  const selected = new Set(plan.acceptanceTasks);
  if (!selected.size || selected.size !== plan.acceptanceTasks.length) throw Error('Distinct original acceptance tasks required.');
  const mapped = new Set();
  for (const row of plan.subsections) {
    if (!original.has(row.id) || !approved.has(row.id)) throw Error('Subsection was not approved at planning baseline: ' + row.id);
    if (!Array.isArray(row.acceptanceTasks) || !row.acceptanceTasks.length ||
        new Set(row.acceptanceTasks).size !== row.acceptanceTasks.length || row.acceptanceTasks.some(id => !selected.has(id)))
      throw Error('Each original subsection must map to its planned acceptance tasks: ' + row.id);
    row.acceptanceTasks.forEach(id => mapped.add(id));
  }
  if (mapped.size !== selected.size) throw Error('Every selected task must map to original subsection scope.');
  for (const id of selected) {
    const before = baseline.find(row => row.id === id), after = current.find(row => row.id === id);
    const planned = planningQueue.find(row => row.id === id);
    if (!before || !after || !planned || !same(before, planned))
      throw Error('Use an existing task and preserve its original state through the planning commit: ' + id);
    if (before.status === 'PASSED' || after.status !== 'PASSED' || !nonempty(after.lastEvidence) || before.lastEvidence === after.lastEvidence)
      throw Error('New genuine passed evidence required; prior passes, audits and pending checks count zero: ' + id);
    // Do not allow a smaller/repinned/less restricted task to inherit the original acceptance claim.
    const scope = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['status','lastEvidence','nextAction'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    if (!same(scope(before), scope(after))) throw Error('Original task scope, source pin and gates must be unchanged: ' + id);
    if (!after.dependsOn.every(dep => current.some(row => row.id === dep && row.status === 'PASSED')))
      throw Error('Acceptance dependencies must have passed: ' + id);
  }
  return { status: 'COMPLETION_DELTA_CHECKED', tasks: [...selected],
    note: 'Accounting only. Independently verify actual deployment, authorization, evidence truth, full outcome, CI and substantial workload.' };
}

/** Compare committed records on the reviewed branch, and rerun on merged main at closeout.
 * This function fetches nothing and changes no file, ref or provider state. */
export function verifyCompletionEvidence(root, plan, plannedAt) {
  if (!SHA.test(plan.baseRevision) || !SHA.test(plannedAt)) throw Error('Completion needs exact baseline/planning revisions.');
  const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:5000, maxBuffer:16*1024*1024, stdio:['ignore','pipe','ignore']}).trim();
  git('merge-base','--is-ancestor',plan.baseRevision,plannedAt);
  git('merge-base','--is-ancestor',plannedAt,'HEAD');
  const policy = JSON.parse(git('show',plan.baseRevision+':docs/session-policy.json'));
  if (!/^docs\/[A-Za-z0-9_./-]+\.md$/.test(policy.ledger) || policy.ledger.split('/').includes('..')) throw Error('Invalid original ledger path.');
  const currentPolicy = JSON.parse(readFileSync(resolve(root,'docs/session-policy.json'),'utf8'));
  if (policy.repository !== currentPolicy.repository || policy.ledger !== currentPolicy.ledger) throw Error('Original repository/ledger policy must not change to manufacture completion.');
  const queue = revision => readQueue(git('show',revision+':'+policy.ledger));
  const index = revision => JSON.parse(git('show',revision+':docs/pr-cards/work-index.json'));
  return assessCompletionEvidence(plan, queue(plan.baseRevision), queue('HEAD'), index(plan.baseRevision), index('HEAD'), queue(plannedAt));
}
