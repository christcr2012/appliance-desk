import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from './build-recovery.mjs';
test('resource termination blocks repeated unchanged build modes and permits one diagnosed retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'build-recovery-'));let calls=0;
 const base={dir,fingerprint:'same-build-inputs',memoryMiB:4096,execute:()=>{calls++;throw Object.assign(Error('killed'),{status:137});}};
 try{
  writeFileSync(join(dir,'next-build'),'previous success marker');
  assert.throws(()=>runBuild(base),/killed/);
  assert.equal(existsSync(join(dir,'next-build')),false);
  assert.throws(()=>runBuild(base),/Unchanged browser build/);assert.equal(calls,1);
  const retry={...base,retryReason:'Measured memory diagnosis supports one controlled retry'};
  assert.throws(()=>runBuild(retry),/killed/);assert.equal(calls,2);
  assert.throws(()=>runBuild(retry),/Unchanged browser build/);assert.equal(calls,2);
  runBuild({...base,memoryMiB:8192,execute:()=>{calls++;}});assert.equal(calls,3);
  assert.equal(existsSync(join(dir,'browser-build-resource-failure.json')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('changed source can be retried; ordinary test/compiler failures never become resource blockers',()=>{
 const dir=mkdtempSync(join(tmpdir(),'build-recovery-'));
 try{
  const base={dir,fingerprint:'first-source',memoryMiB:4096,execute:()=>{throw Object.assign(Error('aborted'),{status:134});}};
  assert.throws(()=>runBuild(base),/aborted/);
  assert.doesNotThrow(()=>runBuild({...base,fingerprint:'fixed-build-inputs',execute:()=>{}}));
  for(let i=0;i<2;i++)assert.throws(()=>runBuild({...base,execute:()=>{throw Object.assign(Error('type error'),{status:1});}}),/type error/);
  assert.equal(existsSync(join(dir,'browser-build-resource-failure.json')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
