import test from 'node:test';
import assert from 'node:assert/strict';
import { runPhase } from './ci-phase.mjs';
const args=['--budget-seconds','180','--','node','check.js'];
const measured=(seconds,result)=>{let i=0;return runPhase(args,{execute:()=>result,clock:()=>i++?seconds*1000:0,output:()=>{}});};
test('passing tests cannot hide a growing serial phase beyond the feedback budget',()=>{
 assert.equal(measured(179,{status:0}).exitCode,0);assert.equal(measured(181,{status:0}).exitCode,1);
});
test('failed, signalled and interrupted checks remain failures regardless of timing',()=>{
 for(const r of [{status:17},{status:0,signal:'SIGTERM'},{error:Error('timeout')}])assert.equal(measured(1,r).exitCode,1);
 assert.equal(runPhase(['--budget-seconds','180','--',process.execPath,'-e','process.exit(17)'],{output:()=>{}}).exitCode,1);
});
test('budget increases and missing commands refuse instead of silently relaxing the limit',()=>{
 assert.throws(()=>runPhase(['--budget-seconds','181','--','node','check.js']),/1–180/);
 assert.throws(()=>runPhase(['--budget-seconds','180','--']),/Usage/);
});
