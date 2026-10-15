// Checkout-local resource-termination evidence; never a build pass or CI waiver.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function runBuild({ fingerprint, memoryMiB, execute, dir, retryReason='' }) {
 const path=join(dir,'browser-build-resource-failure.json');
 let prior=null;
 if(existsSync(path)){try{prior=JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('Local build failure record is unreadable; inspect it before retrying, never claim a build pass.');}}
 const unchanged=prior?.fingerprint===fingerprint&&memoryMiB<=prior.memoryMiB;
 const diagnosticRetry=unchanged&&typeof retryReason==='string'&&retryReason.trim().length>=20&&!prior.diagnosticRetryUsed;
 if(unchanged&&!diagnosticRetry)throw Error('Unchanged browser build already terminated (exit '+prior.exit+'). Use the existing supported runner/required normal CI. One diagnosed retry may use LOCAL_BUILD_RESOURCE_RETRY_REASON (20+ characters); further retries require changed source or increased available memory. --fresh and different build flags do not erase this failure.');
 const used=Boolean(unchanged&&(prior.diagnosticRetryUsed||diagnosticRetry));
 // A failed fresh rebuild may leave an old BUILD_ID beside partial artifacts.
 rmSync(join(dir,'next-build'),{force:true});
 try { execute(); }
 catch(error){
  // These are resource-like process exits, not proof that application code is bad.
  // Ordinary assertion/compiler failures remain normal failures and are never cached.
  if([134,137].includes(error.status)||['SIGKILL','SIGABRT'].includes(error.signal)){
   mkdirSync(dir,{recursive:true});writeFileSync(path,JSON.stringify({fingerprint,memoryMiB,exit:error.status??error.signal,diagnosticRetryUsed:used})+'\n',{mode:0o600});
  }
  throw error;
 }
 rmSync(path,{force:true});
}
