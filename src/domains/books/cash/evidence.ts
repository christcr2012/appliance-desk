import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getPrivatePhotoStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";
import { CashEvidenceError } from "./accounts";

function verified(url:string,scope:string) {
 const store=getPrivatePhotoStore();
 if(!store)throw new CashEvidenceError("Independent private banking evidence storage is not configured.");
 const pathname=privatePhotoPathFromUrl(url,store.storeId);
 if(!pathname||!pathname.startsWith(scope))
  throw new CashEvidenceError("Evidence URL is outside the verified private account and namespace.");
 return pathname;
}
export async function attachBankStatement(userId:string,importId:string,url:string){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  await tx.$queryRaw`SELECT "id" FROM "BankImport" WHERE "id"=${importId} FOR UPDATE`;
  const item=await tx.bankImport.findUnique({where:{id:importId}});
  if(!item||item.privateEvidenceId)throw new CashEvidenceError("Bank evidence missing or already attached.");
  verified(url,"bank-statements/"+item.cashAccountId+"/");
  const photo=await tx.photo.create({data:{url,altText:"Private bank statement evidence"}});
  await tx.bankImport.update({where:{id:importId},data:{privateEvidenceId:photo.id}});
  await tx.auditLog.create({data:{userId,action:"books.bank.evidence.attach",
   entityType:"BankImport",entityId:importId,newValue:{photoId:photo.id}}});
  return photo.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function attachAccountingConfirmation(userId:string,deliveryId:string,url:string){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "AccountingDelivery" WHERE "id"=${deliveryId} FOR UPDATE`;
  const item=await tx.accountingDelivery.findUnique({where:{id:deliveryId}});
  if(!item||item.privateEvidenceId)throw new CashEvidenceError("Accounting delivery not found or evidence already attached.");
  verified(url,"accounting-confirmations/"+deliveryId+"/");
  const photo=await tx.photo.create({data:{url,altText:"Private accounting import confirmation"}});
  await tx.accountingDelivery.update({where:{id:deliveryId},data:{privateEvidenceId:photo.id}});
  await tx.auditLog.create({data:{userId,action:"books.accounting.delivery.evidence",
    entityType:"AccountingDelivery",entityId:deliveryId,newValue:{photoId:photo.id}}});
  return photo.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
