import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { lastCompletedMonth } from "./depreciation";
import { enrollBookAssetInTx, postBookDepreciationInTx } from "./fixed-assets";
import { postPending } from "./post";

type ProblemKind = "APPLIANCE_NOT_ENROLLED" | "SOURCE_NOT_RECORDED";
type Problem = { kind: ProblemKind; subjectType: string; subjectId: string; message: string };
type Counts = { posted: number; enrolled: number; depreciated: number; skipped: number; problems: number };
const MAX_ENROLLMENTS = 200;
const MAX_DEPRECIATIONS = 200;

function problemKey(p:{kind:string;subjectType:string;subjectId:string}) { return [p.kind,p.subjectType,p.subjectId].join("|"); }
function plainCapitalProblem(message:string):string {
 if(message.includes("acquisition") || message.includes("Capitalized expense") || message.includes("capital"))
  return "Record how it was paid for (an expense or 'paid personally').";
 return "Check the appliance's purchase price and acquisition evidence.";
}

/**
 * Runs with no user identity only from the approved cron/books setup service. One asset per
 * serializable transaction: a bad appliance must not prevent other assets from updating.
 * A run can be retried; the immutable journal event keys prevent duplicate entries.
 */
export async function runBooksAutopilot(now = new Date()):Promise<Counts> {
 const counts:Counts={posted:0,enrolled:0,depreciated:0,skipped:0,problems:0};
 const settings=await prisma.businessSettings.findUnique({
  where:{id:"singleton"},select:{booksStartDate:true},
 });
 if(!settings?.booksStartDate)return counts;
 const seen=new Map<string,Problem>();
 let failed=false;
 const add=(p:Problem)=>{seen.set(problemKey(p),p);counts.skipped++;};
 try{
  const posted=await postPending({limit:500});
  counts.posted=posted.posted;
  for(const p of posted.problems){
   add({kind:"SOURCE_NOT_RECORDED",subjectType:p.sourceType,subjectId:p.sourceId,
    message:"This source could not be recorded. Open the original record and check its details."});
   failed=true;
  }
  // A missing purchase price must never take one of the limited auto-enrollment slots.
  const candidates=await prisma.appliance.findMany({
   where:{status:{not:"RETIRED"},bookAsset:{is:null},acquisitionCostCents:{gt:0}},
   select:{id:true,assetNumber:true,acquisitionCostCents:true,purchaseDate:true,createdAt:true},
   orderBy:[{createdAt:"asc"},{id:"asc"}],take:MAX_ENROLLMENTS,
  });
  const missingCosts=await prisma.appliance.findMany({
   where:{status:{not:"RETIRED"},bookAsset:{is:null},
    OR:[{acquisitionCostCents:null},{acquisitionCostCents:{lte:0}}]},
   select:{id:true},
   orderBy:[{createdAt:"asc"},{id:"asc"}],take:MAX_ENROLLMENTS,
  });
  for(const appliance of missingCosts)
   add({kind:"APPLIANCE_NOT_ENROLLED",subjectType:"APPLIANCE",subjectId:appliance.id,
    message:"Add what you paid for it on the appliance page."});
  for(const appliance of candidates){
   const candidateKey=businessDateKey(appliance.purchaseDate??appliance.createdAt);
   const startKey=businessDateKey(settings.booksStartDate);
   const placedDateKey=candidateKey<startKey?startKey:candidateKey;
   try {
    await prisma.$transaction(tx=>enrollBookAssetInTx(tx,{kind:"automatic"},appliance.id,placedDateKey,"AUTOMATIC"),
     {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
    counts.enrolled++;
   }catch(error){
    add({kind:"APPLIANCE_NOT_ENROLLED",subjectType:"APPLIANCE",subjectId:appliance.id,
     message:plainCapitalProblem(error instanceof Error?error.message:"Unknown books problem")});
    failed=true;
   }
  }
  const completed=lastCompletedMonth(now);
  const firstOfCompleted=businessDateFromKey(completed+"-01")!;
  const owing=await prisma.bookAsset.findMany({
   where:{retiredOn:null,fullyDepreciatedOn:null,placedInServiceOn:{lt:firstOfCompleted},
    OR:[{lastDepreciationMonth:null},{lastDepreciationMonth:{lt:completed}}]},
   select:{applianceId:true},
   orderBy:[{lastDepreciationMonth:"asc"},{applianceId:"asc"}],take:MAX_DEPRECIATIONS,
  });
  for(const asset of owing){
   try {
    const updated=await prisma.$transaction(
     tx=>postBookDepreciationInTx(tx,{kind:"automatic"},asset.applianceId,completed,{maxMonths:360}),
     {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
    counts.depreciated+=updated.posted;
   }catch(error){
    add({kind:"APPLIANCE_NOT_ENROLLED",subjectType:"APPLIANCE",subjectId:asset.applianceId,
     message:"The equipment value could not be updated. Review its cost and previous entries."});
    failed=true;
   }
  }
  // Resolve only known, processed subjects: an unvisited page must not make an old problem disappear.
  for(const p of seen.values()){
   await prisma.booksProblem.upsert({
    where:{kind_subjectType_subjectId:{kind:p.kind,subjectType:p.subjectType,subjectId:p.subjectId}},
    create:{...p,firstSeenAt:now,lastSeenAt:now},
    update:{message:p.message,lastSeenAt:now,resolvedAt:null},
   });
  }
  const processedIds=new Set([...candidates.map(x=>x.id),...missingCosts.map(x=>x.id),...owing.map(x=>x.applianceId)]);
  const old=await prisma.booksProblem.findMany({where:{kind:"APPLIANCE_NOT_ENROLLED",resolvedAt:null,
   subjectId:{in:[...processedIds]}},select:{id:true,subjectId:true,kind:true,subjectType:true}});
  for(const p of old)if(!seen.has(problemKey(p))){
   await prisma.booksProblem.update({where:{id:p.id},data:{resolvedAt:now}});
  }
  counts.problems=seen.size;
 }catch(error){
  failed=true;
  throw error;
 }finally{
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = ${"singleton"} FOR UPDATE`;
   const previous=await tx.businessSettings.findUniqueOrThrow({where:{id:"singleton"},
    select:{booksConsecutiveFailedNights:true}});
   await tx.businessSettings.update({where:{id:"singleton"},data:{
    booksLastBroughtUpToDateAt:now,booksLastProblemCount:counts.problems,
    booksConsecutiveFailedNights:failed?previous.booksConsecutiveFailedNights+1:0,
   }});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 return counts;
}
