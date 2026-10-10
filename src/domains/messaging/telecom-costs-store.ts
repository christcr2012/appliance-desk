import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { reconcileVerifiedTelecomStatement, summarizeProviderUsage,
  summarizeResourceCosts, type DifferenceTolerance } from "./telecom-costs";
import { previewTelecomCostAlerts, type TelecomAlertRules } from "./telecom-alerts";

const DAY = 86_400_000;
/** Internal finance projection only; callers must enforce OWNER/ADMIN rights. */
export async function getTelecomSpend(input: {
  accountId: string; actorUserId: string; periodStart: Date; periodEnd: Date;
  now?: Date; tolerance: DifferenceTolerance; alertRules?: TelecomAlertRules;
}) {
  const { accountId, periodStart, periodEnd } = input;
  const now=input.now ?? new Date();
  if (![periodStart,periodEnd,now].every(d=>d instanceof Date && Number.isFinite(+d)) ||
      periodStart>periodEnd || periodEnd.getTime()-periodStart.getTime()>93*DAY ||
      [periodStart,periodEnd].some(d=>d.getUTCHours()!==0 || d.getUTCMinutes()!==0 ||
        d.getUTCSeconds()!==0 || d.getUTCMilliseconds()!==0)) {
    throw new Error("INVALID_PROVIDER_PERIOD");
  }
  await prisma.$transaction(tx => assertActiveTeamActor(tx,input.actorUserId,["OWNER","ADMIN"]));
  const account=await prisma.telecomAccount.findUnique({ where:{id:accountId},select:{id:true} });
  if (!account) throw new Error("TELECOM_ACCOUNT_NOT_FOUND");
  const through=new Date(+periodEnd+DAY);
  const [usageRows,costRows,statements,cursor]=await Promise.all([
    prisma.telecomUsageSnapshot.findMany({
      where: { accountId, startDate:{gte:periodStart},endDate:{lte:periodEnd} },
      take:2001, orderBy:[{providerAsOf:"desc"},{id:"desc"}],
      select:{id:true,category:true,isTotal:true,startDate:true,endDate:true,
        price:true,currency:true,providerAsOf:true,capturedAt:true},
    }),
    prisma.communicationCostFact.findMany({
      where: { accountId, occurredAt:{gte:periodStart,lt:through},supersededBy:null },
      take:2001, orderBy:[{occurredAt:"desc"},{id:"desc"}],
      select:{amount:true,currency:true,classification:true,
        messageAttemptId:true,callLegId:true},
    }),
    prisma.telecomStatement.findMany({
      where:{accountId,periodStart,periodEnd,state:"VERIFIED",
        verifiedByUserId:{not:null},verifiedAt:{not:null}},
      take:3,orderBy:[{revision:"desc"},{id:"desc"}],
      select:{invoiceTotalCents:true,currency:true,externalId:true},
    }),
    prisma.telecomSyncCursor.findUnique({
      where:{accountId_resource:{accountId,resource:"USAGE"}},
      select:{lastSuccessAt:true,lastFailureAt:true,lastErrorCode:true,completedThrough:true},
    }),
  ]);
  if (usageRows.length>2000 || costRows.length>2000) {
    throw new Error("TELECOM_EVIDENCE_TOO_LARGE_TO_ASSERT_COMPLETE");
  }
  const usage=summarizeProviderUsage(usageRows,periodStart,periodEnd);
  const resources=summarizeResourceCosts(costRows);
  // More than one independently verified statement for the same provider
  // interval is ambiguous; do not arbitrarily choose the newest.
  const statement=statements.length===1 ? statements[0] : null;
  const reconciliation=reconcileVerifiedTelecomStatement(
    usage.accountTotalCents,usage.currency,statement,input.tolerance);
  const freshness={
    lastSuccessAt:cursor?.lastSuccessAt??null,
    lastFailureAt:cursor?.lastFailureAt??null,
    lastErrorCode:cursor?.lastErrorCode??null,
    completedThrough:cursor?.completedThrough??null,
  };
  const preview=input.alertRules ? previewTelecomCostAlerts({
    rules:input.alertRules,currentCents:usage.accountTotalCents,
    currentComplete:usage.complete,previousCents:null,previousComplete:false,
    sameLengthWindow:false,lastUsageSyncAt:freshness.lastSuccessAt,now,
    invoiceMismatch:reconciliation.mismatch,
    unknownCategories:usage.unknownCategories,
  }) : null;
  return {
    period:{fromGMT:periodStart.toISOString().slice(0,10),
      throughGMT:periodEnd.toISOString().slice(0,10)},
    usage:{basis:"PROVIDER_REPORTED" as const,...usage},
    resources:{basis:"PROVIDER_REPORTED_RESOURCE_ONLY" as const,...resources},
    statement:{basis:"INVOICE_RECONCILED" as const,
      state:statements.length>1?"AMBIGUOUS":statement?"VERIFIED":"MISSING",
      invoiceTotalCents:statement?.invoiceTotalCents??null},
    reconciliation, freshness, alertPreview:preview,
    bookedExpenseCents:null, // K/COM-N remains the sole posting authority.
  };
}
