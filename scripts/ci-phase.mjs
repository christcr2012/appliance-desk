// Timed CI phase: preserve command failures and fail, rather than hide, budget growth.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function runPhase(args, { execute=spawnSync, clock=()=>performance.now(), output=console.log }={}) {
 if(args[0]!=='--budget-seconds'||!/^\d+$/.test(args[1]??'')||args[2]!=='--'||args.length<4)throw Error('Usage: ci-phase --budget-seconds SECONDS -- command [args]');
 const budget=Number(args[1]);if(budget<1||budget>180)throw Error('CI feedback budget must be 1–180 seconds; profile/split growing cohorts rather than raising it.');
 const start=clock();
 const result=execute(args[3],args.slice(4),{stdio:'inherit',timeout:(budget+30)*1000});
 const seconds=(clock()-start)/1000;
 const passed=!result.error&&!result.signal&&result.status===0;
 const summary={seconds:Number(seconds.toFixed(2)),budgetSeconds:budget,commandPassed:passed,withinBudget:seconds<=budget};
 output('[CI phase] '+JSON.stringify(summary));
 if(!passed)output('Verification command failed or timed out; no passing evidence. Diagnose the original failure.');
 else if(seconds>budget)output('CI feedback budget exceeded. Inspect timing, fix demonstrated slowdown or split independent test cohorts with complete coverage; do not increase the budget or skip tests.');
 return { ...summary, exitCode:passed&&seconds<=budget?0:1 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try {
  const r=runPhase(process.argv.slice(2));process.exitCode=r.exitCode;
  if(process.env.GITHUB_STEP_SUMMARY){try{appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nVerification phase: ${r.seconds}s / ${r.budgetSeconds}s; command ${r.commandPassed?'passed':'FAILED'}; budget ${r.withinBudget?'met':'EXCEEDED'}.\n`);}catch{console.log('Timing summary unavailable; command/budget result remains binding.');}}
 }catch(error){console.error(error.message);process.exitCode=1;}
}
