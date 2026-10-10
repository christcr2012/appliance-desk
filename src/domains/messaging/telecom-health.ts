import { prisma } from "@/lib/prisma";
import { telecomIssueScope, telecomSyncFinding, telecomStatementFinding } from "./telecom-attention";
import type { SystemIssueInput } from "@/domains/system-issues/types";

type Sweep = { issues:SystemIssueInput[]; cleared:string[] };
const DAY=86_400_000;
/**
 * PII-free read-only telemetry for the existing S sweep. No provider calls,
 * expense posting or budget notifications. Never clears an unseen partial page.
 */
export async function collectTelecomAttention(now:Date):Promise<Sweep> {
  const accounts=await prisma.telecomAccount.findMany({
    where:{status:{in:["READY","DEGRADED"]}},
    take:26,orderBy:{id:"asc"},
    select:{id:true,status:true,syncCursors:{where:{resource:"USAGE"},take:1,
      select:{lastSuccessAt:true,lastFailureAt:true}} },
  });
  if (accounts.length>25) throw new Error("TELECOM_SWEEP_SCOPE_TOO_LARGE");
  const issues:SystemIssueInput[]=[];
  const cleared:string[]=[];
  for (const account of accounts) {
    const scope=telecomIssueScope(account.id);
    const cursor=account.syncCursors[0];
    if (cursor?.lastSuccessAt) {
      const issue=telecomSyncFinding({
        scope,status:account.status,now,
        lastSuccessAt:cursor.lastSuccessAt,lastFailureAt:cursor.lastFailureAt,
      });
      if (issue?.kind==="TELECOM_SYNC_STALE") issues.push({
        kind:"TELECOM_SYNC_STALE",scope,lastSuccessAt:issue.lastSuccessAt!,
        lastFailureAt:issue.lastFailureAt,
      });
      else cleared.push("telecom-sync:"+scope);
    }
    const statements=await prisma.telecomStatement.findMany({
      where:{accountId:account.id,state:"VERIFIED",verifiedAt:{not:null},
        verifiedByUserId:{not:null},
        periodEnd:{gte:new Date(+now-93*DAY)}},
      take:26,orderBy:[{periodEnd:"desc"},{id:"desc"}],
      select:{periodStart:true,periodEnd:true,currency:true,invoiceTotalCents:true},
    });
    if (statements.length>25) continue; // Never clear issues from partial evidence.
    const periods=new Map<string,number>();
    for (const statement of statements) {
      const key=statement.periodStart.toISOString().slice(0,10)+":"+statement.periodEnd.toISOString().slice(0,10);
      periods.set(key,(periods.get(key)??0)+1);
    }
    for (const statement of statements) {
      const start=statement.periodStart.toISOString().slice(0,10);
      const key=start+":"+statement.periodEnd.toISOString().slice(0,10);
      if (periods.get(key)!==1) continue;
      const latest=await prisma.telecomUsageSnapshot.findMany({
        where:{accountId:account.id,isTotal:true,startDate:statement.periodStart,
          endDate:statement.periodEnd},
        take:26,orderBy:[{providerAsOf:"desc"},{capturedAt:"desc"}],
        select:{price:true,currency:true,providerAsOf:true,capturedAt:true},
      });
      if (!latest.length || latest.length>25 || latest[0].price===null ||
          latest.some(p=>p.currency!==statement.currency)) continue;
      const finding=telecomStatementFinding({
        scope,period:start,verifiedCents:statement.invoiceTotalCents,
        currency:statement.currency,observations:latest,
      });
      if (finding) issues.push({kind:"TELECOM_STATEMENT_DIFFERENCE",scope,period:start});
      else cleared.push("telecom-statement:"+scope+":"+start);
    }
  }
  return {issues,cleared};
}
