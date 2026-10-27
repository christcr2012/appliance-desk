import test from 'node:test';
import assert from 'node:assert/strict';
import { runPhase } from './ci-phase.mjs';
const args=['--budget-seconds','180','--','node','check.js'];
const measured=(seconds,result)=>{let i=0;return runPhase(args,{execute:()=>result,clock:()=>i++?seconds*1000:0,output:()=>{}});};
test('an occasional slow passing phase is informational, not a red CI or repeat run',()=>{
 assert.equal(measured(179,{status:0}).exitCode,0);
 const messages=[];let tick=0;let options;
 const result=runPhase(args,{execute:(_cmd,_argv,opts)=>{options=opts;return{status:0};},clock:()=>tick++?181000:0,output:msg=>messages.push(msg)});
 assert.equal(result.exitCode,0);
 assert.equal(result.withinBudget,false);
 assert.equal(options.timeout,600_000);
 assert.ok(messages.some(m=>m.includes('::notice title=Slow CI phase')));
 assert.ok(messages.some(m=>m.includes('[CI phase]')));
});
test('failed, signalled and interrupted checks remain failures regardless of timing',()=>{
 for(const r of [{status:17},{status:0,signal:'SIGTERM'},{error:Error('timeout')}])assert.equal(measured(1,r).exitCode,1);
 assert.equal(runPhase(['--budget-seconds','180','--',process.execPath,'-e','process.exit(17)'],{output:()=>{}}).exitCode,1);
});
test('budget increases and missing commands refuse instead of silently relaxing the limit',()=>{
 assert.throws(()=>runPhase(['--budget-seconds','181','--','node','check.js']),/1–180/);
 assert.throws(()=>runPhase(['--budget-seconds','180','--']),/Usage/);
});
