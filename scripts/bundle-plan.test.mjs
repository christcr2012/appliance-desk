import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBundlePlan, assessBundleDelivery, run } from './bundle-plan.mjs';
const plan = () => ({ baseRevision: 'a'.repeat(40), outcome: 'Complete a usable connected domain workflow',
  integrationBoundary: 'Service, persistence and all existing callers', newEngineering: 'Build missing domain behavior and caller integration',
  relatedWorkDecision: 'Include related second subsection in approved order', estimatedProductionLines: 650,
  subsections: ['A-1', 'A-2'].map(id => ({ id, acceptance: ['Complete permitted and refused domain behavior'],
    remainingEngineering: ['Implement the missing domain and caller integration'] })) });
const card = p => '<!-- bundle-plan:start -->\n```json\n' + JSON.stringify(p) + '\n```\n<!-- bundle-plan:end -->';
const delivery = p => ({ subsections: p.subsections.map(row => ({ id: row.id, remainingEngineering: [],
  criteria: row.acceptance.map(criterion => ({ criterion, evidence: 'Actual code and proving integration test references' })) })),
  productionAdded: 650, productionRemoved: 20, decision: 'SUBSTANTIAL',
  planComparison: 'Delivered both planned full outcomes with no engineering omitted',
  newEngineering: 'Actual service and persistence integration newly implemented',
  relatedWorkDecision: 'Both related approved outcomes delivered in one coherent tree' });

test('delivery cannot omit planned subsections or substitute criterion text', () => {
  const p = plan(), r = delivery(p);
  assert.equal(assessBundleDelivery(p, r).status, 'SCOPE_ACCOUNTING_CHECKED');
  r.subsections.pop(); assert.throws(() => assessBundleDelivery(p, r), /EVERY/);
  const changed = delivery(p); changed.subsections[0].criteria[0].criterion = 'Easier helper only';
  assert.throws(() => assessBundleDelivery(p, changed), /Criterion/);
});
test('a 186-addition card remainder contributes work but does not automatically finish a bundle', () => {
  const p = plan(); p.subsections.pop(); const r = delivery(p);
  r.productionAdded = 186; r.productionRemoved = 11;
  assert.throws(() => assessBundleDelivery(p, r), /explicit substantial-work exception/);
  r.decision = 'CONTINUE';
  assert.equal(assessBundleDelivery(p, r).status, 'CONTINUE_BUNDLE');
  r.decision = 'SUBSTANTIAL_EXCEPTION'; r.exceptionEvidence = ['New engineering workload and integration evidence for review'];
  const result = assessBundleDelivery(p, r);
  assert.equal(result.underGuide, true);
  assert.equal(result.requiresSubstantialityReview, true); // Never an automatic certificate of substance.
});
test('unfinished or zero-production work cannot complete even with a workload assertion', () => {
  const p = plan(), r = delivery(p);
  r.subsections[1].remainingEngineering = ['Actual missing persistence and failure recovery'];
  assert.equal(assessBundleDelivery(p, r).status, 'CONTINUE_BUNDLE');
  const empty = delivery(p); empty.productionAdded = 0; empty.productionRemoved = 0;
  assert.equal(assessBundleDelivery(p, empty).status, 'CONTINUE_BUNDLE');
  const duplicate = plan(); duplicate.subsections.push(duplicate.subsections[0]);
  assert.throws(() => readBundlePlan(card(duplicate)), /distinct/);
});
test('CLI verifies an immutable pre-code plan in real Git history and performs no writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-plan-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
  try {
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    mkdirSync(join(root, 'docs/pr-cards'), { recursive: true });
    writeFileSync(join(root, 'docs/base.md'), 'Approved roadmap'); git('add', '.'); git('commit', '-m', 'baseline');
    const p = plan(); p.baseRevision = git('rev-parse', 'HEAD');
    const path = 'docs/pr-cards/existing.md'; writeFileSync(join(root, path), card(p));
    assert.equal(run(root, ['--card', path]).status, 'PLAN_SHAPE_CHECKED');
    git('add', '.'); git('commit', '-m', 'plan before coding'); const plannedAt = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'implementation.js'), 'export const actual = true;'); git('add', '.'); git('commit', '-m', 'implementation');
    writeFileSync(join(root, 'report.json'), JSON.stringify(delivery(p)));
    const args = ['--card', path, '--planned-at', plannedAt, '--report', 'report.json'];
    const before = git('status', '--porcelain');
    assert.equal(run(root, args).status, 'SCOPE_ACCOUNTING_CHECKED');
    assert.equal(git('status', '--porcelain'), before);
    const changed = plan(); changed.baseRevision = p.baseRevision; changed.subsections.pop();
    writeFileSync(join(root, path), card(changed));
    assert.throws(() => run(root, args), /Frozen plan changed/);
    writeFileSync(join(root, path), card(p));
    assert.throws(() => run(root, ['--card', path, '--planned-at', 'HEAD', '--report', 'report.json']), /exact full/);
    // A plan created together with implementation is not a pre-code plan.
    const late = plan(); late.baseRevision = git('rev-parse', 'HEAD');
    writeFileSync(join(root, path), card(late)); writeFileSync(join(root, 'late.js'), 'export const late = true;');
    git('add', '.'); git('commit', '-m', 'late plan with code');
    assert.throws(() => run(root, ['--card', path, '--planned-at', git('rev-parse','HEAD'), '--report', 'report.json']), /precede implementation/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
