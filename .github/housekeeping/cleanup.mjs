import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const sha=/^[a-f0-9]{40}$/;
export function validatePlan(p,repo){
 if(p?.maintenanceBranch!==undefined&&p.maintenanceBranch!=='ai/codex/completion-recovery-20261014')throw Error('Invalid maintenance branch');
 if(p?.version!==1||p.repository!==repo||!/^archive\/housekeeping-2026-10-13$/.test(p.archive)||!Array.isArray(p.branches)||p.branches.length>300)throw Error('Invalid repository-bound plan');
 const seen=new Set();
 for(const b of p.branches){if(!/^(ai\/|copilot\/|phase-3-reversible-state$)/.test(b.name)||!/^[A-Za-z0-9/_-]+$/.test(b.name)||!sha.test(b.sha)||seen.has(b.name)||!['merged','superseded','test-fixture'].includes(b.disposition))throw Error('Invalid pinned branch');seen.add(b.name);}
 return p;
}
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export const ancestor=(a,b)=>spawnSync('git',['merge-base','--is-ancestor',a,b],{stdio:'ignore'}).status===0;
export function selectCandidates(plan,remote,active){
 const candidates=[],retained=[],absent=[];
 for(const b of plan.branches){if(!remote.has(b.name))absent.push(b);else if(remote.get(b.name)!==b.sha||active.has(b.name))retained.push(b);else candidates.push(b);}
 return {candidates,retained,absent};
}
export function createArchive(main,heads,previous){
 const tree=git(['rev-parse',main+'^{tree}']);
 let archive=previous||main;
 for(let i=0;i<heads.length;i+=16){const parents=[...new Set([archive,...heads.slice(i,i+16)])];archive=execFileSync('git',['commit-tree',tree,...parents.flatMap(x=>['-p',x]),'-m','Preserve owner-authorized historical branch tips; never merge this archive'],{encoding:'utf8'}).trim();}
 if(git(['rev-parse',archive+'^{tree}'])!==tree||heads.some(h=>!ancestor(h,archive)))throw Error('Archive provenance failed');
 return archive;
}
// Only this owner-reviewed maintenance branch can prune itself, and only once
// its exact current tip is actually merged. A concurrently advanced tip stays.
export function includeMaintenanceBranch(plan,remote,main,check=ancestor){
 const name=plan.maintenanceBranch,sha=name&&remote.get(name);
 if(!sha||!check(sha,main)||plan.branches.some(b=>b.name===name))return plan;
 if(plan.branches.length>=300)throw Error('Maintenance inventory exceeds bound');
 return {...plan,branches:[...plan.branches,{name,sha,disposition:'merged'}]};
}
export function archiveCoversPlan(plan,main,archive,initial,check=ancestor){
 // A new exact, present candidate will be archived and read back BEFORE
 // deletion below. A missing unpreserved source still fails closed.
 return plan.branches.every(b=>check(b.sha,archive)||check(b.sha,main)||
  initial.retained.includes(b)||initial.candidates.includes(b));
}
async function activeBranches(repo){
 const r=await fetch('https://api.github.com/repos/'+repo+'/pulls?state=open&per_page=100',{headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Cannot verify open PRs');const prs=await r.json();if(!Array.isArray(prs)||prs.length>=100)throw Error('Incomplete open PR inventory');
 const refs=new Set();for(const pr of prs){if(pr.head?.repo?.full_name===repo)refs.add(pr.head.ref);if(pr.base?.repo?.full_name===repo)refs.add(pr.base.ref);}return refs;
}
const remoteHeads=()=>new Map(git(['ls-remote','--heads','origin']).split('\n').filter(Boolean).map(s=>{const [v,r]=s.split(/\s+/);return [r.slice('refs/heads/'.length),v];}));
export async function run(){
 const repo=process.env.GITHUB_REPOSITORY;let plan=validatePlan(JSON.parse(readFileSync(new URL('./plan.json',import.meta.url),'utf8')),repo);
 if(process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GITHUB_TOKEN||Date.now()>Date.parse('2026-10-16T00:00:00Z'))throw Error('Outside authorized one-time maintenance context');
 git(['fetch','--quiet','--no-tags','--prune','origin','+refs/heads/*:refs/remotes/origin/*']);
 const main=git(['rev-parse','refs/remotes/origin/main']);let remote=remoteHeads();
 plan=includeMaintenanceBranch(plan,remote,main);
 const own='ai/codex/git-housekeeping-20261013';const ownSha=remote.get(own);if(ownSha&&ancestor(ownSha,main))plan.branches.push({name:own,sha:ownSha,disposition:'merged'});
 const initial=selectCandidates(plan,remote,await activeBranches(repo));
 git(['config','user.name','github-actions[bot]']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
 const oldArchive=remote.get(plan.archive);if(oldArchive&&!archiveCoversPlan(plan,main,oldArchive,initial))throw Error('Existing archive does not preserve pinned history');
 const heads=initial.candidates.map(b=>b.sha);let archive=oldArchive;
 if(heads.length){archive=createArchive(main,heads,oldArchive);git(['push','--porcelain','--force-with-lease=refs/heads/'+plan.archive+':'+(oldArchive||''),'origin',archive+':refs/heads/'+plan.archive]);}
 remote=remoteHeads();if(archive&&remote.get(plan.archive)!==archive)throw Error('Published archive readback mismatch');
 // Every absent source must have independently retained history before accepting a retry.
 for(const b of initial.absent){if(!ancestor(b.sha,main)&&(!archive||!ancestor(b.sha,archive)))throw Error('Missing branch lacks preservation proof: '+b.name);}
 const deleted=[],retained=[...initial.retained];
 for(let i=0;i<initial.candidates.length;i+=20){
  const batch=initial.candidates.slice(i,i+20);const latest=selectCandidates({branches:batch},remoteHeads(),await activeBranches(repo));retained.push(...latest.retained);
  for(const b of latest.candidates)if(!archive||!ancestor(b.sha,archive))throw Error('Branch not archived');
  if(latest.candidates.length){git(['push','--atomic','--porcelain',...latest.candidates.map(b=>'--force-with-lease=refs/heads/'+b.name+':'+b.sha),'origin',...latest.candidates.map(b=>':refs/heads/'+b.name)]);deleted.push(...latest.candidates);}
 }
 const final=remoteHeads();if(deleted.some(b=>final.has(b.name))||(archive&&final.get(plan.archive)!==archive))throw Error('Cleanup remote readback failed');
 const result={repository:repo,archive,deleted:deleted.map(b=>b.name),retained:retained.map(b=>b.name),previouslyAbsent:initial.absent.length,remainingBranches:[...final.keys()]};
 console.log(JSON.stringify(result));if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Verified Git housekeeping\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
