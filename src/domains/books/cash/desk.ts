import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

/** No balances are invented. This is only registered source and journal evidence. */
export async function getCashDesk(userId:string) {
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,userId,["OWNER","ADMIN","ACCOUNTANT"]);
    const [registered,availableBanks,events] = await Promise.all([
      tx.cashAccount.findMany({where:{active:true},orderBy:{createdAt:"asc"},take:100,
        include:{ledgerAccount:{select:{id:true,name:true}},
          imports:{orderBy:{createdAt:"desc"},take:10,
            select:{id:true,status:true,rowCount:true,createdAt:true,privateEvidenceId:true,sha256:true}}}}),
      tx.ledgerAccount.findMany({where:{active:true,type:"ASSET",isPaymentSource:true,
        cashAccount:{is:null},OR:[{systemRole:"BANK"},{systemRole:null}]},
        select:{id:true,name:true},orderBy:{name:"asc"},take:100}),
      tx.bookCashEvent.findMany({orderBy:{createdAt:"desc"},take:80,select:{
        id:true,kind:true,status:true,amountCents:true,occurredOn:true,memo:true,
        version:true,reversalOfId:true,fromLedgerAccountId:true,toLedgerAccountId:true,
      }}),
    ]);
    return {registered,availableBanks,events};
  });
}
