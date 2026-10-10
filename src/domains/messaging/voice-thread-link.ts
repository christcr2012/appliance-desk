import type { Prisma } from "@prisma/client";

type Tx=Prisma.TransactionClient;
type Key={accountId:string;businessNumberId:string;contactPointId:string};
/** Strictly the same account, owned number and canonical contact-point key. */
export async function confirmedVoiceThread(tx:Tx,key:Key):Promise<string|null> {
  const thread=await tx.communicationThread.findUnique({
    where:{accountId_businessNumberId_externalContactPointId:{
      accountId:key.accountId,businessNumberId:key.businessNumberId,
      externalContactPointId:key.contactPointId,
    }},
    select:{id:true,resolution:true,customerId:true,leadId:true},
  });
  if (!thread || thread.resolution!=="RESOLVED" ||
      Number(Boolean(thread.customerId))+Number(Boolean(thread.leadId))!==1) return null;
  return thread.id;
}
/** Link only when the thread has already been resolved to one explicit subject. */
export async function linkEarlierConfirmedCalls(tx:Tx,key:Key,threadId:string):Promise<number> {
  const verified=await confirmedVoiceThread(tx,key);
  if (verified!==threadId) return 0;
  const result=await tx.callSession.updateMany({where:{
    accountId:key.accountId,businessNumberId:key.businessNumberId,
    contactPointId:key.contactPointId,threadId:null,
  },data:{threadId}});
  return result.count;
}
