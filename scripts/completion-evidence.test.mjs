import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assessCompletionEvidence } from './completion-evidence.mjs';
import { run } from './bundle-plan.mjs';

const revision='a'.repeat(40);
const task=()=>({id:'REAL-ACCEPTANCE',priority:1,requiredRevision:revision,status:'PENDING',
  task:'Original full approved real-provider lifecycle',procedure:'Existing card and scoped runner',
  gates:'Original explicit TEST approval and exact cleanup',dependsOn:[],lastEvidence:'Not performed'});
const index=status=>({cards:[{id:'A-1',units:['A-1'],status}]});
const plan=()=>({workKind:'COMPLETION',baseRevision:revision,estimatedProductionLines:0,
  outcome:'Complete the original full real-provider workflow',integrationBoundary:'Actual deployed server, provider, denial, recovery and cleanup',
  newEngineering:'No application code needed; original real-world proof remains',
  relatedWorkDecision:'Complete one original connected workflow rather than an isolated read',
  acceptanceTasks:['REAL-ACCEPTANCE'],subsections:[{id:'A-1',acceptance:[task().task],remainingEngineering:[],
    remainingWork:['Perform original scoped full provider workflow and retain truthful evidence'],acceptanceTasks:['REAL-ACCEPTANCE']}]});
const passed=()=>({...task(),status:'PASSED',lastEvidence:'New exact serving source, permitted provider readback, denied path, recovery and cleanup receipts'});
const delivery=p=>({productionAdded:0,productionRemoved:0,decision:'SUBSTANTIAL_EXCEPTION',
  exceptionEvidence:['Substantial original full provider lifecycle with independent real readbacks, denial, recovery and exact cleanup; no inherited code counted'],
  newEngineering:p.newEngineering,planComparison:'Every frozen original criterion now completed with actual provider receipts',relatedWorkDecision:p.relatedWorkDecision,
  subsections:p.subsections.map(row=>({id:row.id,remainingEngineering:[],remainingWork:[],criteria:row.acceptance.map(criterion=>({criterion,evidence:'Exact reviewed source and new sanitized provider lifecycle receipts in permanent records'}))}))});

test('new completion on merged source is eligible without manufacturing production changes',()=>{
  const result=assessCompletionEvidence(plan(),[task()],[passed()],index('MERGED'),index('MERGED'));
  assert.equal(result.status,'COMPLETION_DELTA_CHECKED');
  assert.deepEqual(result.tasks,['REAL-ACCEPTANCE']);
});
test('old/reused/pending evidence, changed gates or pins and optional scope cannot manufacture completion',()=>{
  for(const [before,after]of[
    [passed(),passed()],[task(),task()],[task(),{...passed(),lastEvidence:task().lastEvidence}],
    [task(),{...passed(),gates:'Weakened approval'}],[task(),{...passed(),requiredRevision:'b'.repeat(40)}],
    [task(),{...passed(),task:'Only an easier read'}],[task(),{...passed(),introducedFile:'different-proof.js'}]
  ])assert.throws(()=>assessCompletionEvidence(plan(),[before],[after],index('MERGED'),index('MERGED')));
  for(const state of['ON_REQUEST','PLANNED','PROPOSED — documentation review required'])
    assert.throws(()=>assessCompletionEvidence(plan(),[task()],[passed()],index(state),index('MERGED')),/not approved/);
  const unmapped=plan();unmapped.subsections[0].acceptanceTasks=[];
  assert.throws(()=>assessCompletionEvidence(unmapped,[task()],[passed()],index('MERGED'),index('MERGED')),/map/);
  assert.throws(()=>assessCompletionEvidence(plan(),[task()],[passed()],index('MERGED'),index('MERGED'),[passed()]),/planning commit/);
  const dependent={...task(),dependsOn:['DEPENDENCY']};
  assert.throws(()=>assessCompletionEvidence(plan(),[dependent],[{...passed(),dependsOn:['DEPENDENCY']},{...task(),id:'DEPENDENCY'}],index('MERGED'),index('MERGED')),/dependencies/);
});
test('actual Git CLI verifies frozen scope and NEW committed receipts without moving refs or changing files',()=>{
  const root=mkdtempSync(join(tmpdir(),'completion-delta-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  const ledger=row=>'<!-- release-acceptance:start -->\n```json\n'+JSON.stringify([row])+'\n```\n<!-- release-acceptance:end -->';
  try{
    git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
    mkdirSync(join(root,'docs/pr-cards'),{recursive:true});
    writeFileSync(join(root,'docs/session-policy.json'),JSON.stringify({repository:'fixture/service',ledger:'docs/STATUS.md'}));
    writeFileSync(join(root,'docs/pr-cards/work-index.json'),JSON.stringify(index('MERGED')));
    writeFileSync(join(root,'docs/STATUS.md'),ledger(task()));git('add','.');git('commit','-m','original source already merged');
    const p={...plan(),baseRevision:git('rev-parse','HEAD')},card='docs/pr-cards/existing.md';
    writeFileSync(join(root,card),'<!-- bundle-plan:start -->\n```json\n'+JSON.stringify(p)+'\n```\n<!-- bundle-plan:end -->');
    assert.equal(run(root,['--card',card]).status,'PLAN_SHAPE_CHECKED');
    git('add','.');git('commit','-m','freeze original completion');const plannedAt=git('rev-parse','HEAD');
    const path=join(root,'report.json');writeFileSync(path,JSON.stringify(delivery(p)));
    const args=['--card',card,'--planned-at',plannedAt,'--report',path];
    // Even a local uncommitted PASSED edit cannot satisfy the committed evidence gate.
    writeFileSync(join(root,'docs/STATUS.md'),ledger(passed()));
    assert.throws(()=>run(root,args),/New genuine passed/);
    git('add','docs/STATUS.md');git('commit','-m','new original real-world evidence');
    const before=git('status','--porcelain'),head=git('rev-parse','HEAD');
    const result=run(root,args);assert.equal(result.status,'SCOPE_ACCOUNTING_CHECKED');
    assert.equal(result.completion.status,'COMPLETION_DELTA_CHECKED');
    assert.equal(git('status','--porcelain'),before);assert.equal(git('rev-parse','HEAD'),head);
    // A rerun only checks the same claim; it is not a second bundle or a new permission.
    assert.deepEqual(run(root,args),result);
  }finally{rmSync(root,{recursive:true,force:true});}
});
