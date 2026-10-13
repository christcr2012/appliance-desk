import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validatePlan,selectCandidates,createArchive,ancestor} from './cleanup.mjs';
const pinned='a'.repeat(40);const plan={version:1,repository:'owner/repo',archive:'archive/housekeeping-2026-10-13',branches:[{name:'ai/old',sha:pinned,disposition:'merged'}]};
test('refuses wrong repository, protected refs, duplicates, malformed SHAs and unapproved dispositions',()=>{
 assert.equal(validatePlan(plan,'owner/repo'),plan);assert.throws(()=>validatePlan(plan,'other/repo'));
 for(const name of ['main','live','archive/keep','ai/x:main','ai/../main'])assert.throws(()=>validatePlan({...plan,branches:[{...plan.branches[0],name}]},'owner/repo'));
 assert.throws(()=>validatePlan({...plan,branches:[...plan.branches,...plan.branches]},'owner/repo'));
 assert.throws(()=>validatePlan({...plan,branches:[{...plan.branches[0],sha:'bad'}]},'owner/repo'));
 assert.throws(()=>validatePlan({...plan,branches:[{...plan.branches[0],disposition:'unfinished'}]},'owner/repo'));
});
test('advanced tips and active PR head/base references are retained; missing sources need later provenance checks',()=>{
 assert.equal(selectCandidates(plan,new Map([['ai/old',pinned]]),new Set()).candidates.length,1);
 assert.equal(selectCandidates(plan,new Map([['ai/old','b'.repeat(40)]]),new Set()).retained.length,1);
 assert.equal(selectCandidates(plan,new Map([['ai/old',pinned]]),new Set(['ai/old'])).retained.length,1);
 assert.equal(selectCandidates(plan,new Map(),new Set()).absent.length,1);
});
test('real archive retains divergent tips without introducing their file trees, including multi-commit archive batches',()=>{
 const dir=mkdtempSync(join(tmpdir(),'git-housekeeping-'));const prior=process.cwd();process.chdir(dir);
 const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{git(['init','-q']);git(['config','user.name','Test']);git(['config','user.email','test@example.invalid']);writeFileSync('current','approved');git(['add','.']);git(['commit','-qm','baseline']);const main=git(['rev-parse','HEAD']);const tree=git(['rev-parse','HEAD^{tree}']);const heads=[];
 writeFileSync('historical-only','obsolete source must stay outside main');git(['add','historical-only']);const historicalTree=git(['write-tree']);
 for(let i=0;i<21;i++)heads.push(git(['commit-tree',historicalTree,'-p',main,'-m','preserved '+i]));
 const archive=createArchive(main,heads);assert.equal(git(['rev-parse',archive+'^{tree}']),tree);for(const h of heads)assert.equal(ancestor(h,archive),true);
 git(['init','--bare','-q','remote.git']);git(['remote','add','origin',join(dir,'remote.git')]);git(['push','-q','origin',main+':refs/heads/main',heads[0]+':refs/heads/ai/old',archive+':refs/heads/archive/test']);
 // A stale lease refuses deletion and keeps both the original branch and archived history.
 assert.throws(()=>git(['push','--force-with-lease=refs/heads/ai/old:'+heads[1],'origin',':refs/heads/ai/old']));assert.match(git(['ls-remote','--heads','origin','refs/heads/ai/old']),new RegExp(heads[0]));
 git(['push','--atomic','--force-with-lease=refs/heads/ai/old:'+heads[0],'origin',':refs/heads/ai/old']);assert.equal(git(['ls-remote','--heads','origin','refs/heads/ai/old']),'');assert.equal(ancestor(heads[0],archive),true);
 }finally{process.chdir(prior);rmSync(dir,{recursive:true,force:true});}
});
