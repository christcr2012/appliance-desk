import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resourceProfile, prepare, publication } from './session-prepare.mjs';

test('resource report honors container limits and never assumes host RAM is available', () => {
  const mib = 1048576;
  assert.deepEqual(resourceProfile(path => path.endsWith('memory.max') ? String(4096*mib) : 'max', 32768*mib, 2048*mib), {memoryMiB:4096,heapMiB:2048});
  assert.equal(resourceProfile(() => 'max', 8192*mib, 1024*mib).memoryMiB,8192);
  assert.equal(resourceProfile(() => {throw Error('not exposed');},8192*mib,1024*mib).memoryMiB,8192);
});
test('orientation lists only existing commands without installing or running them', () => {
  const root=mkdtempSync(join(tmpdir(),'session-prepare-'));
  try {
    writeFileSync(join(root,'package.json'),JSON.stringify({scripts:{check:'never execute',test:'never execute'},engines:{node:'24.x'}}));
    const r=prepare(root);
    assert.equal(r.commands.check,'npm run check');assert.equal(r.commands['test:db'],undefined);
    assert.equal(r.dependenciesInstalled,false);assert.equal(r.requiredNode,'24.x');
    mkdirSync(join(root,'prisma'));writeFileSync(join(root,'prisma/schema.prisma'),'generator client { provider = "prisma-client-js" }');
    assert.equal(prepare(root).generatedPrismaClient,'MISSING_OR_STALE');
    mkdirSync(join(root,'node_modules/.prisma/client'),{recursive:true});
    writeFileSync(join(root,'node_modules/.prisma/client/schema.prisma'),'generator client { provider = "prisma-client-js" }');
    assert.equal(prepare(root).generatedPrismaClient,'CURRENT');
    writeFileSync(join(root,'prisma/schema.prisma'),'generator client { provider = "prisma-client-js" } model Changed { id Int @id }');
    assert.equal(prepare(root).generatedPrismaClient,'MISSING_OR_STALE');
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('publication refuses failed refresh, dirty work and unsupported comparison without exposing Git diagnostics', () => {
  assert.throws(()=>publication('.',()=>({status:128,stderr:'https://credential@private.invalid'})), error=>!error.message.includes('credential')&&/No fresh publication/.test(error.message));
  assert.throws(()=>publication('.',args=>({status:0,stdout:args[0]==='status'?' M docs/STATUS.md':''})),/coherent local checkpoint/);
});
test('real concurrent-main conflict is found before publication without changing refs or worktree', () => {
  const root=mkdtempSync(join(tmpdir(),'publication-prepare-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  const remote=join(root,'remote.git'),work=join(root,'work');mkdirSync(work);
  const wgit=(...args)=>execFileSync('git',args,{cwd:work,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  try {
    git('init','--bare',remote);wgit('init');wgit('config','user.name','Fixture');wgit('config','user.email','fixture@example.invalid');
    writeFileSync(join(work,'record.md'),'original\n');wgit('add','.');wgit('commit','-m','baseline');wgit('branch','-M','main');wgit('remote','add','origin',remote);wgit('push','-u','origin','main');
    wgit('checkout','-b','implementation');writeFileSync(join(work,'record.md'),'implementation\n');wgit('commit','-am','implementation');const head=wgit('rev-parse','HEAD');
    wgit('checkout','main');writeFileSync(join(work,'record.md'),'concurrent main\n');wgit('commit','-am','concurrent');wgit('push','origin','main');wgit('checkout','implementation');
    const before=wgit('status','--porcelain');const r=publication(work);
    assert.equal(r.status,'RECONCILE_CONFLICTS');assert.deepEqual(r.overlap,['record.md']);
    assert.equal(wgit('rev-parse','HEAD'),head);assert.equal(wgit('status','--porcelain'),before);
    // A real reconciliation clears the prediction; it never bypasses CI.
    wgit('merge','origin/main','-s','ours','-m','fixture reconciliation');
    assert.equal(publication(work).status,'PUBLICATION_BASE_CURRENT');
  } finally {rmSync(root,{recursive:true,force:true});}
});
