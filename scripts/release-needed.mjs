// Source-readiness hints only: never approval, deployment attestation or release execution.
const SHA = /^[a-f0-9]{40}$/;
export function planReleaseAlert(plan, observation, isAncestor) {
  const {main,live,deployed,deploymentState}=observation;
  if (deploymentState!=='READY' || ![main,live,deployed].every(sha=>SHA.test(sha||'')) ||
      isAncestor(live,main)!==true || isAncestor(deployed,live)!==true)
    return {status:'VERIFY_DEPLOYMENT_FIRST',releaseTasks:[],deploymentTasks:[]};
  const releaseTasks=[],deploymentTasks=[];
  for(const row of plan){
    if(!['WAIT_RELEASE_OR_FETCH_HISTORY','RECHECK_AFTER_ROLLBACK'].includes(row.disposition) ||
        isAncestor(row.requiredRevision,main)!==true || isAncestor(row.requiredRevision,deployed)!==false)continue;
    const inLive=isAncestor(row.requiredRevision,live);
    const task={id:row.id,requiredRevision:row.requiredRevision,gates:row.gates};
    if(inLive===false)releaseTasks.push(task);
    else if(inLive===true)deploymentTasks.push(task);
    // Unknown ancestry needs history retrieval, never a speculative release.
  }
  return {status:releaseTasks.length?'RELEASE_NEEDED':deploymentTasks.length?'DEPLOYMENT_PENDING':'NO_CONFIRMED_RELEASE_BLOCK',
    main,live,deployed,releaseTasks,deploymentTasks};
}
export function releaseAlertLines(alert){
  const lines=[];
  if(alert.releaseTasks.length)lines.push(
    'RELEASE NEEDED for original acceptance: '+alert.releaseTasks.map(row=>row.id).join(', ')+'.',
    'Prepare the exact checked main target '+alert.main+' and explain what release unlocks; alert the owner in the active chat and request explicit manual-release approval when needed. The scheduled release may also satisfy this prerequisite.',
    'No release is authorized by this diagnostic or by Do N bundles. Preserve all checks/release restrictions, other prerequisites and independent eligible work; recheck actual READY/source and acceptance after deployment.');
  if(alert.deploymentTasks.length)lines.push('DEPLOYMENT FOLLOW-UP needed: live already contains source for '+alert.deploymentTasks.map(row=>row.id).join(', ')+'. Inspect the serving/build state; do not request a redundant new release.');
  return lines;
}
