import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
/** A public estimate link is only an invitation to decline an existing offer.
 * It must never grant login, mutate billing, or expose any other customer's data. */
export async function declineOfferedEstimate(estimateId:string, reason:string) {
  if(typeof reason!=="string"||reason.length>1000) throw new Error("Invalid reason.");
  return prisma.$transaction(async tx=>{
    const found=await tx.$queryRaw<Array<{id:string}>>`
      SELECT "id" FROM "Estimate" WHERE "id"=${estimateId} FOR UPDATE`;
    if(!found.length)throw new Error("Estimate is not available.");
    const e=await tx.estimate.findUnique({where:{id:estimateId},
      select:{status:true,validUntil:true,customerId:true,createdByUserId:true}});
    if(!e||!["SENT","VIEWED"].includes(e.status)||
      (e.validUntil&&e.validUntil.getTime()<Date.now()))
      throw new Error("Estimate is no longer awaiting a response.");
    await tx.estimate.update({where:{id:estimateId},
      data:{status:"DECLINED",respondedAt:new Date(),declineReason:reason||null}});
    await tx.auditLog.create({data:{action:"estimate.declined",entityType:"Estimate",
      entityId:estimateId,newValue:{reasonProvided:!!reason}}});
    if(e.customerId)
      await tx.staffTask.create({data:{customerId:e.customerId,
        sourceKey:"estimate-declined:"+estimateId,priority:"NORMAL",
        createdByUserId:e.createdByUserId,
        note:"Customer declined estimate "+estimateId+". Review the estimate for any stated reason."}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
