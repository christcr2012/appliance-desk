import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkLayout, policy } from './check-ci-layout.mjs';
const source = () => readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url),'utf8');
test('actual verification families remain parallel and every job reaches the required gate',()=>{
 assert.equal(checkLayout(source()).gate,policy.gate);
 const id=policy.parallel.find(x=>x!==policy.parallel[0]);
 const serialized=source().replace('  '+id+':\n','  '+id+':\n    needs: '+policy.parallel[0]+'\n');
 assert.throws(()=>checkLayout(serialized),/serialized/);
 const ignored=source().replace('  '+id+':\n','  '+id+':\n    continue-on-error: true\n');
 assert.throws(()=>checkLayout(ignored),/silently ignore/);
 const gate=source().replace('needs: [','needs: [not-a-real-job, ');
 assert.throws(()=>checkLayout(gate),/dependency|EVERY/);
});
test('timeout increases and removed aggregate result checks cannot hide slow/missing work',()=>{
 const id=policy.parallel[0];
 const increased=source().replace(new RegExp('(  '+id+':\\n[\\s\\S]*?timeout-minutes:) \\d+'),'$1 999');
 assert.throws(()=>checkLayout(increased),/timeout/);
 const missing=source().replaceAll('needs.'+id+'.result','needs.'+id+'.ignored');
 assert.throws(()=>checkLayout(missing),/inspect result/);
 assert.throws(()=>checkLayout(source().replaceAll('scripts/ci-phase.mjs','scripts/untimed.mjs')),/Missing measured/);
 assert.throws(()=>checkLayout(source().replaceAll('--budget-seconds 180','--budget-seconds 181')),/feedback budget increased/);
});
test('each exact unit/browser group must remain in CI, not merely the old minimum count',()=>{
 const src=source();
 assert.equal(policy.matrices.unit,3);
 assert.equal(policy.matrices.e2e,5);
 for (const [from,to] of [
  ['shard: [1, 2, 3]','shard: [1, 2]'],
  ['shard: [browser-a, browser-b, browser-c, browser-d, browser-e]','shard: [browser-a, browser-b, browser-c, browser-d]'],
  ['shard: [1, 2, 3]','shard: [1, 2, 2]'],
 ]) {
  assert.ok(src.includes(from), 'Real matrix exists: '+from);
  assert.throws(()=>checkLayout(src.replace(from,to)),/collapse, disappear, duplicate or serialize/);
 }
});
test('sharded cohorts cannot silently become one serial runner',()=>{
 for(const [id] of Object.entries(policy.matrices??{})){
  const changed=source().replace(new RegExp('(  '+id+':\\n[\\s\\S]*?strategy:\\n)'), '$1      max-parallel: 1\n');
  assert.throws(()=>checkLayout(changed),/collapse, disappear, duplicate or serialize/);
 }
});
