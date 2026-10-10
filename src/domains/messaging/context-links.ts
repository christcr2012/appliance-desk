import {prisma} from "@/lib/prisma";
import {requireRole} from "@/lib/session";
import type {ContextKind} from "./context-evidence";
export async function linkMessageContext(input:{
 threadId:string;messageId:string;kind:ContextKind;entityId:string;
}){
 const actor=await requireRole("OWNER","ADMIN");
 if(!input.threadId||!input.messageId||!input.entityId||input.entityId.length>200)
  throw new Error("Invalid communication link.");
 if(!["Job","MaintenanceRequest","Invoice"].includes(input.kind))
  throw new Error("Invalid context type.");
 return prisma.$transaction(async tx=>{
  const message=await tx.communicationMessage.findFirst({
   where:{id:input.messageId,threadId:input.threadId,
    thread:{resolution:"RESOLVED",customerId:{not:null}}},
   select:{thread:{select:{customerId:true}}},
  });
  const customerId=message?.thread.customerId;
  if(!customerId) throw new Error("No confirmed customer identity.");
  const found=input.kind==="Job"
   ?await tx.job.findFirst({where:{id:input.entityId,customerId},select:{id:true}})
   :input.kind==="MaintenanceRequest"
    ?await tx.maintenanceRequest.findFirst({where:{id:input.entityId,customerId},select:{id:true}})
    :await tx.invoice.findFirst({where:{id:input.entityId,customerId},select:{id:true}});
  if(!found) throw new Error("Record does not belong to this customer.");
  await tx.communicationLink.upsert({
   where:{messageId_entityType_entityId:{
    messageId:input.messageId,entityType:input.kind,entityId:input.entityId,
   }},
   create:{messageId:input.messageId,entityType:input.kind,
    entityId:input.entityId,source:"EXPLICIT",actorUserId:actor.user.id},
   update:{},
  });
  await tx.auditLog.create({data:{
   userId:actor.user.id,action:"COMMUNICATION_CONTEXT_LINKED",
   entityType:input.kind,entityId:input.entityId,
   newValue:{messageId:input.messageId},
  }});
 });
}
export async function getContextLinkChoices(customerId:string){
 await requireRole("OWNER","ADMIN");
 const [jobs,maintenance,invoices]=await Promise.all([
  prisma.job.findMany({where:{customerId},take:10,
   orderBy:[{createdAt:"desc"},{id:"desc"}],
   select:{id:true,type:true}}),
  prisma.maintenanceRequest.findMany({where:{customerId},take:10,
   orderBy:[{openedAt:"desc"},{id:"desc"}],
   select:{id:true,status:true}}),
  prisma.invoice.findMany({where:{customerId},take:10,
   orderBy:[{createdAt:"desc"},{id:"desc"}],
   select:{id:true,invoiceNumber:true}}),
 ]);
 return [
  ...jobs.map(x=>({value:"Job:"+x.id,label:"Job "+x.type})),
  ...maintenance.map(x=>({value:"MaintenanceRequest:"+x.id,label:"Maintenance "+x.status})),
  ...invoices.map(x=>({value:"Invoice:"+x.id,label:"Invoice #"+x.invoiceNumber})),
 ];
}
