// Read-only scope accounting. This is not proof of substantiality, CI or acceptance.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const words = value => typeof value === 'string' && value.trim().length >= 12 && value.length <= 3000;
const list = value => Array.isArray(value) && value.length > 0 && value.every(words);
const same = (a, b) => a.length === b.length && a.every(value => b.includes(value));

export function readBundlePlan(card) {
  const start = '<!-- bundle-plan:start -->', end = '<!-- bundle-plan:end -->';
  if (card.split(start).length !== 2 || card.split(end).length !== 2)
    throw Error('Existing execution card needs exactly one bundle-plan block.');
  const match = /^```json\s*\n([\s\S]*?)\n```$/.exec(card.split(start)[1].split(end)[0].trim());
  if (!match) throw Error('Bundle plan must be one fenced JSON object.');
  const plan = JSON.parse(match[1]);
  if (!plan || !SHA.test(plan.baseRevision) || !words(plan.outcome) ||
      !words(plan.integrationBoundary) || !words(plan.newEngineering) || !words(plan.relatedWorkDecision) ||
      !Number.isSafeInteger(plan.estimatedProductionLines) || plan.estimatedProductionLines < 1 ||
      !Array.isArray(plan.subsections) || !plan.subsections.length)
    throw Error('Plan needs baseline, outcome, integration, NEW engineering estimate and related-work selection.');
  const ids = new Set();
  for (const row of plan.subsections) {
    if (!row || !/^[A-Z0-9][A-Z0-9-]{1,79}$/.test(row.id) || ids.has(row.id) ||
        !list(row.acceptance) || !list(row.remainingEngineering))
      throw Error('Plan needs distinct existing subsection IDs, full acceptance and remaining NEW engineering.');
    ids.add(row.id);
  }
  return plan;
}

export function assessBundleDelivery(plan, report) {
  // Validate the same schema for callers that already decoded a plan.
  readBundlePlan('<!-- bundle-plan:start -->\n```json\n' + JSON.stringify(plan) + '\n```\n<!-- bundle-plan:end -->');
  if (!report || !Array.isArray(report.subsections) ||
      !same(plan.subsections.map(row => row.id), report.subsections.map(row => row?.id)) ||
      new Set(report.subsections.map(row => row?.id)).size !== report.subsections.length)
    throw Error('Delivery must account for EVERY originally planned subsection; never shrink the plan after coding.');
  let incomplete = false;
  for (const row of plan.subsections) {
    const actual = report.subsections.find(item => item.id === row.id);
    if (!Array.isArray(actual.remainingEngineering) || !actual.remainingEngineering.every(words) ||
        !Array.isArray(actual.criteria) || actual.criteria.length !== row.acceptance.length)
      throw Error('Every planned criterion needs evidence and each subsection needs explicit remaining engineering.');
    if (actual.remainingEngineering.length) incomplete = true;
    for (let i = 0; i < row.acceptance.length; i++) {
      const criterion = actual.criteria[i];
      if (criterion?.criterion !== row.acceptance[i] || !words(criterion.evidence))
        throw Error('Criterion text/order must match the frozen plan with concrete evidence.');
    }
  }
  if (!Number.isSafeInteger(report.productionAdded) || report.productionAdded < 0 ||
      !Number.isSafeInteger(report.productionRemoved) || report.productionRemoved < 0 ||
      !words(report.planComparison) || !words(report.newEngineering) || !words(report.relatedWorkDecision) ||
      !['CONTINUE', 'SUBSTANTIAL', 'SUBSTANTIAL_EXCEPTION'].includes(report.decision))
    throw Error('Delivery needs actual production measurements, plan comparison, new-work evidence and continuation decision.');
  const changed = report.productionAdded + report.productionRemoved;
  const underGuide = plan.subsections.length < 2 || changed < 400;
  if (report.decision === 'CONTINUE' || incomplete || changed === 0)
    return { status: 'CONTINUE_BUNDLE', underGuide, plannedSubsections: plan.subsections.map(row => row.id) };
  if (underGuide && (report.decision !== 'SUBSTANTIAL_EXCEPTION' || !list(report.exceptionEvidence)))
    throw Error('Below-guide delivery needs an explicit substantial-work exception and evidence; completing a small card is insufficient.');
  return { status: 'SCOPE_ACCOUNTING_CHECKED', underGuide, requiresSubstantialityReview: true,
    plannedSubsections: plan.subsections.map(row => row.id) };
}

export function verifyFrozenPlan(root, cardPath, revision) {
  if (!/^docs\/[A-Za-z0-9_./-]+\.md$/.test(cardPath) || cardPath.split('/').includes('..')) throw Error('Use a repository execution card under docs/.');
  const git = (...values) => execFileSync('git', values, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!SHA.test(revision)) throw Error('Use an exact full planning commit SHA.');
  git('merge-base', '--is-ancestor', revision, 'HEAD');
  const plan = readBundlePlan(git('show', revision + ':' + cardPath));
  const current = readBundlePlan(readFileSync(resolve(root, cardPath), 'utf8'));
  if (JSON.stringify(current) !== JSON.stringify(plan)) throw Error('Frozen plan changed; preserve it and explain deviations in delivery.');
  if (git('rev-parse', revision + '^') !== plan.baseRevision) throw Error('Planning commit must directly follow its stated inspected baseline.');
  // The plan may touch its docs/card only, not hide implementation in the same commit.
  const changed = git('diff', '--name-only', plan.baseRevision, revision).split('\n').filter(Boolean);
  if (!changed.length || changed.some(path => !path.startsWith('docs/') && path !== 'AGENTS.md'))
    throw Error('Planning commit must precede implementation; only governing docs/cards may change in that commit.');
  return plan;
}

export function run(root, args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--card', '--planned-at', '--report'].includes(args[i]) || !args[i + 1] || options[args[i]])
      throw Error('Usage: session:bundle -- --card EXISTING_CARD [--planned-at FULL_SHA --report PATH]');
    options[args[i]] = args[i + 1];
  }
  const cardPath = options['--card'];
  if (!cardPath || !/^docs\/[A-Za-z0-9_./-]+\.md$/.test(cardPath) || cardPath.split('/').includes('..'))
    throw Error('Use an existing repository execution card under docs/.');
  if (Boolean(options['--planned-at']) !== Boolean(options['--report'])) throw Error('Delivery requires both --planned-at and --report.');
  const git = (...values) => execFileSync('git', values, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!options['--planned-at']) {
    const plan = readBundlePlan(readFileSync(resolve(root, cardPath), 'utf8'));
    if (git('rev-parse', 'HEAD') !== plan.baseRevision) throw Error('Plan baseline must be current HEAD before its planning commit.');
    return { status: 'PLAN_SHAPE_CHECKED', subsections: plan.subsections.map(row => row.id),
      next: 'Review approved scope; commit the card before implementation and retain that exact SHA.' };
  }
  const plan = verifyFrozenPlan(root, cardPath, options['--planned-at']);
  const report = JSON.parse(readFileSync(resolve(root, options['--report']), 'utf8'));
  return assessBundleDelivery(plan, report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = run(resolve(fileURLToPath(new URL('..', import.meta.url))), process.argv.slice(2));
    console.log(JSON.stringify(result));
    console.log('Scope accounting only. Independently review approved scope, meaningful NEW workload, CI, reviews and acceptance.');
    if (result.status === 'CONTINUE_BUNDLE') process.exitCode = 2;
  } catch (error) { console.error('Bundle scope refused: ' + error.message); process.exitCode = 1; }
}
