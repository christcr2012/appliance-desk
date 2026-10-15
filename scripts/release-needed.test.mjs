import test from 'node:test';
import assert from 'node:assert/strict';
import {planReleaseAlert,releaseAlertLines}from './release-needed.mjs';
const old='a'.repeat(40),live='b'.repeat(40),next='c'.repeat(40),main='d'.repeat(40);
const ancestor=(a,b)=>[old,live,next,main].indexOf(a)<=[old,live,next,main].indexOf(b);
const obs={main,live,deployed:live,deploymentState:'READY'};
const row=(id,requiredRevision,disposition='WAIT_RELEASE_OR_FETCH_HISTORY')=>({id,requiredRevision,disposition,gates:'Original scoped permission and fixture ownership still required'});
test('identify exact missing released source without global main/live equality or automatic approval',()=>{
 const alert=planReleaseAlert([row('OLDER',old,'DEPLOYED_CANDIDATE_CHECK_GATES'),row('NEW',next)],obs,ancestor);
 assert.equal(alert.status,'RELEASE_NEEDED');assert.deepEqual(alert.releaseTasks.map(x=>x.id),['NEW']);
 assert.match(releaseAlertLines(alert).join('\n'),/request explicit manual-release approval/);
 assert.match(releaseAlertLines(alert).join('\n'),/No release is authorized/);
 assert.match(releaseAlertLines(alert).join('\n'),/Do not request a manual release while implementation/);
 assert.match(releaseAlertLines(alert).join('\n'),/Only after no other eligible authorized work remains/);
});
test('source already in live needs deployment follow-up, not another release',()=>{
 const alert=planReleaseAlert([row('PENDING',live)],{...obs,deployed:old},ancestor);
 assert.equal(alert.status,'DEPLOYMENT_PENDING');assert.equal(alert.releaseTasks.length,0);
 assert.match(releaseAlertLines(alert).join('\n'),/do not request a redundant/);
});
test('unknown provenance/history and optional external prerequisites cannot fabricate a release need',()=>{
 for(const change of[{deployed:null},{deploymentState:'BUILDING'},{main:'main'}])
  assert.equal(planReleaseAlert([row('NEW',next)],{...obs,...change},ancestor).status,'VERIFY_DEPLOYMENT_FIRST');
 const unknown=(a,b)=>a===next?null:ancestor(a,b);
 assert.equal(planReleaseAlert([row('UNKNOWN',next)],obs,unknown).status,'NO_CONFIRMED_RELEASE_BLOCK');
 assert.equal(planReleaseAlert([row('PROVIDER',old,'RECHECK_EXTERNAL_GATE')],obs,ancestor).status,'NO_CONFIRMED_RELEASE_BLOCK');
});
