import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { productionPath, parseNumstat, measureDiff, mergedImplementationHistory, validateScorecard, validatePRChange, renderProgress } from './pr-progress.mjs';

const approved = { id:'W-22FIN', slices:[
  {id:'W-22FIN-QUOTE', acceptance:['Quote reconciles', 'Missing taxes deny']},
  {id:'W-22FIN-POLICY', acceptance:['Versioned policy']}
]};
const card = {version:1,kind:'implementation',parent:'W-22FIN',
  completedSlices:[{id:'W-22FIN-QUOTE', acceptanceEvidence:['tests/quote.test.ts: exact cents passed', 'e2e/estimate.spec.ts: unknown denied']}],
  remainingEngineering:['Recovery and invoice path remain unfinished.'],
  externalAcceptance:['Stripe TEST provider readback awaits checked live deployment.']};
const write = (root,p,value) => {const path=resolve(root,p);mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,value);};
const git = (root,...args) => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
function repo() {
  const root=mkdtempSync(join(tmpdir(),'pr-progress-'));
  git(root,'init','-q');git(root,'config','user.email','test@example.test');git(root,'config','user.name','Test');
  write(root,'src/domain.ts','export const owner = 1;\n');
  write(root,'docs/pr-cards/work-index.json',JSON.stringify({activeExecution:'W-22FIN',executionPackets:[{id:'W-22FIN',path:'docs/pr-cards/execution/W-22FIN.json'}]}));
  write(root,'docs/pr-cards/execution/W-22FIN.json',JSON.stringify(approved));
  write(root,'docs/pr-cards/current-pr-scorecard.json',JSON.stringify(card));
  git(root,'add','.');git(root,'commit','-qm','base');
  git(root,'branch','-M','main');
  return root;
}
test('source classification excludes docs, tests, generated code and fixture output', () => {
  for (const p of ['src/domains/rentals/index.ts','src/app/page.tsx','prisma/schema.prisma','prisma/migrations/a/migration.sql']) assert.equal(productionPath(p),true);
  for (const p of ['docs/STATUS.md','scripts/setup.mjs','src/a.spec.ts','src/__tests__/a.ts','src/generated/client.ts','prisma/migrations/migration_lock.toml']) assert.equal(productionPath(p),false);
});
test('zero-terminated numstat ignores excluded paths and binary changes', () => {
  assert.deepEqual(parseNumstat('12\t3\tsrc/a.ts\0'+'7\t4\ttests/a.test.ts\0'+'-\t-\tsrc/image.png\0'+'5\t2\tprisma/schema.prisma\0'),{additions:17,deletions:5,files:2});
});
test('scorecard requires approved complete slices with evidence for every approved criterion', () => {
  assert.equal(validateScorecard(card,approved).completedSlices,1);
  assert.throws(()=>validateScorecard({...card,completedSlices:[{id:'W-22FIN-QUOTE',acceptanceEvidence:['one only']}]},approved),/criterion/);
  assert.throws(()=>validateScorecard({...card,completedSlices:[{id:'W-22FIN-NEW',acceptanceEvidence:['invented']}]},approved),/unapproved/);
  assert.throws(()=>validateScorecard({...card,completedSlices:[...card.completedSlices,...card.completedSlices]},approved),/Duplicate/);
  assert.throws(()=>validateScorecard({...card,completedSlices:[]},approved),/zero/);
  assert.equal(validateScorecard({...card,kind:'maintenance',completedSlices:[]},approved).completedSlices,0);
  assert.throws(()=>validateScorecard({...card,kind:'maintenance'},approved),/Maintenance/);
});
test('git measures production changes, skips maintenance merges, and finds implementation history',()=>{
  const root=repo();
  try {
    const baseline=git(root,'rev-parse','HEAD');
    git(root,'checkout','-qb','feat');
    write(root,'src/domain.ts','export const owner = 1;\nexport const checkout = 2;\n');
    write(root,'src/component.test.ts','test only\n');
    write(root,'docs/note.md','docs only\n');
    write(root,'docs/pr-cards/current-pr-scorecard.json',JSON.stringify({...card,evidence:['PR #101 criterion proof in exact-head CI.']}));
    git(root,'add','.');git(root,'commit','-qm','implement');
    const stats=measureDiff(root,baseline,'HEAD');assert.deepEqual(stats,{additions:1,deletions:0,files:1});
    git(root,'checkout','-q','main');git(root,'merge','--no-ff','-m','Merge pull request #101 from test/feat','feat');
    git(root,'checkout','-qb','docs');
    write(root,'docs/note.md','changed docs only\n');git(root,'add','.');git(root,'commit','-qm','docs');
    git(root,'checkout','-q','main');git(root,'merge','--no-ff','-m','Merge pull request #102 from test/docs','docs');
    const history=mergedImplementationHistory(root,'main');
    assert.deepEqual(history.map(x=>x.pr),[101]);
    assert.equal(history[0].completedSlices,1);
    write(root,'docs/pr-cards/current-pr-scorecard.json',JSON.stringify(card));
    const report=renderProgress(root,baseline,'main');
    assert.match(report,/Rolling production additions average/);
    assert.match(report,/#101 \+1/);
    assert.match(report,/Rolling declared slice average \(2 evidenced PR scorecards, including current\): 1.0/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('format-only edits do not inflate meaningful production additions',()=>{
  const root=repo();try {
    const before=git(root,'rev-parse','HEAD');
    write(root,'src/domain.ts','  export   const owner = 1;\n');
    git(root,'add','.');git(root,'commit','-qm','whitespace only');
    assert.equal(measureDiff(root,before,'HEAD').additions,0);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('PR check rejects stale scorecards and dishonest maintenance source changes', () => {
  const root=repo();
  try {
    const baseline=git(root,'rev-parse','HEAD');
    write(root,'src/domain.ts','export const owner = 1;\nexport const second = 2;\n');
    git(root,'add','.');git(root,'commit','-qm','source without evidence');
    assert.throws(()=>validatePRChange(root,baseline),/must update/);
    write(root,'docs/pr-cards/current-pr-scorecard.json',JSON.stringify({...card,evidence:['Accepted criterion proof supplied by the PR.']}));
    git(root,'add','.');git(root,'commit','-qm','provide current scorecard');
    assert.equal(validatePRChange(root,baseline).additions,1);
    write(root,'docs/pr-cards/current-pr-scorecard.json',JSON.stringify({...card,kind:'maintenance',completedSlices:[],evidence:['This is now falsely called maintenance.']}));
    git(root,'add','.');git(root,'commit','-qm','misclassify customer code');
    assert.throws(()=>validatePRChange(root,baseline),/production code/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
