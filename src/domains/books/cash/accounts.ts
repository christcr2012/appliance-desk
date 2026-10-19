import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export class CashEvidenceError extends Error {}
const label=(value:string,max:number,what:string)=>{
  const v=value.trim();
  if(!v||v.length>max)throw new CashEvidenceError(what+" must be nonempty and at most "+max+" characters.");
  return v;
};
export async function registerCashAccount(userId:string,input:{
  ledgerAccountId:string;name:string;institutionLabel:string;lastFour?:string|null;
}) {
  const name=label(input.name,120,"Account name");
  const institution=label(input.institutionLabel,120,"Institution label");
  const lastFour=input.lastFour?.trim()||null;
  if(lastFour!==null&&!/^\d{4}$/.test(lastFour))
    throw new CashEvidenceError("Only the four-digit account suffix may be stored.");
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,userId,["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "LedgerAccount" WHERE "id"=${input.ledgerAccountId} FOR UPDATE`;
    const account=await tx.ledgerAccount.findUnique({where:{id:input.ledgerAccountId}});
    if(!account?.active || account.type!=="ASSET" || !account.isPaymentSource ||
      (account.systemRole && account.systemRole!=="BANK"))
      throw new CashEvidenceError("Select a verified active business BANK asset source, not a personal or clearing account.");
    const existing=await tx.cashAccount.findUnique({where:{ledgerAccountId:account.id}});
    if(existing)throw new CashEvidenceError("That cash source is already registered; use its existing record.");
    const created=await tx.cashAccount.create({data:{
      ledgerAccountId:account.id,name,institutionLabel:institution,lastFour,
    }});
    await tx.auditLog.create({data:{userId,action:"books.cash.account.enroll",
      entityType:"CashAccount",entityId:created.id,
      newValue:{ledgerAccountId:account.id,name,institution,lastFour,currency:"USD"}}});
    return created.id;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function setCashMatchWindow(userId:string,accountId:string,expectedVersion:number,days:number){
  if(!Number.isSafeInteger(days)||days<0||days>30)
    throw new CashEvidenceError("Choose a whole number of match days between 0 and 30.");
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,userId,["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "CashAccount" WHERE "id"=${accountId} FOR UPDATE`;
    const row=await tx.cashAccount.findUnique({where:{id:accountId}});
    if(!row?.active||row.version!==expectedVersion)
      throw new CashEvidenceError("The account was changed or deactivated; refresh.");
    await tx.cashAccount.update({where:{id:accountId},data:{
      bankMatchWindowDays:days,version:{increment:1},
    }});
    await tx.auditLog.create({data:{userId,action:"books.cash.match-window",entityType:"CashAccount",
      entityId:accountId,oldValue:{days:row.bankMatchWindowDays,version:row.version},
      newValue:{days,version:row.version+1}}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function getCashAccounts(userId:string) {
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
    return tx.cashAccount.findMany({orderBy:{createdAt:"asc"},take:100,
      include:{ledgerAccount:{select:{id:true,name:true,systemRole:true,active:true}},
        imports:{where:{status:"ACTIVE"},select:{id:true,rowCount:true,createdAt:true},take:10,
          orderBy:{createdAt:"desc"}}}});
  });
}
