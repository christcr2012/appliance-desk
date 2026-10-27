// CI phase: report slow runs without failing passing checks. Actual test failures and hangs still fail.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function runPhase(args, { execute=spawnSync, clock=()=>performance.now(), output=console.log }={}) {
 if(args[0]!=='--budget-seconds'||!/^\d+$/.test(args[1]??'')||args[2]!=='--'||args.length<4)throw Error('Usage: ci-phase --budget-seconds SECONDS -- command [args]');
 const budget=Number(args[1]);if(budget<1||budget>180)throw Error('CI feedback budget must be 1–180 seconds; profile/split growing cohorts rather than raising it.');
 const start=clock();
 // A slow-but-healthy run must not turn red at the performance target.
 // Separate 10-minute safety timeout prevents genuinely stuck commands.
 const result=execute(args[3],args.slice(4),{stdio:'inherit',timeout:600_000});
 const seconds=(clock()-start)/1000;
 const passed=!result.error&&!result.signal&&result.status===0;
 const summary={seconds:Number(seconds.toFixed(2)),budgetSeconds:budget,commandPassed:passed,withinBudget:seconds<=budget};
 output('[CI phase] '+JSON.stringify(summary));
 if(!passed)output('Verification command failed or timed out; no passing evidence. Diagnose the original failure.');
 else if(seconds>budget){
  output(`::notice title=Slow CI phase (informational)::${summary.seconds}s exceeded the ${budget}s target; tests passed. Compare this same shard across 5 full runs; consider rebalancing only if at least 3 exceed the target.`);
  output('Informational timing only: do not rerun CI solely for one slow passing phase.');
 }
 return { ...summary, exitCode:passed?0:1 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try {
  const r=runPhase(process.argv.slice(2));process.exitCode=r.exitCode;
  if(process.env.GITHUB_STEP_SUMMARY){try{appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nVerification phase: ${r.seconds}s / ${r.budgetSeconds}s target; command ${r.commandPassed?'passed':'FAILED'}; performance ${r.withinBudget?'on target':'slow (informational, non-failing)'}. Review 3 of 5 comparable runs before rebalancing.\n`);}catch{console.log('Timing summary unavailable; verification command result remains binding.');}}
 }catch(error){console.error(error.message);process.exitCode=1;}
}
