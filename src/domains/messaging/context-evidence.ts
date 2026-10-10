import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { CommunicationLinkEntityType, MessageState } from "@prisma/client";
export type ContextKind = Extract<CommunicationLinkEntityType,"Job"|"MaintenanceRequest"|"Invoice">;
export type ContextEvidence = {
 id:string;at:Date;channel:"EMAIL"|"SMS";direction:"OUTBOUND"|"INBOUND";
 status:string;href:string|null;source:"EXPLICIT_LINK"|"SUBJECT";
};
export function contextStateLabel(state:MessageState):string {
 switch(state){
 case "DELIVERED": return "Delivered (provider confirmed)";
 case "ACCEPTED": return "Accepted by provider, not confirmed delivered";
 case "FAILED": return "Failed, needs review";
 case "BOUNCED": return "Bounced, not delivered";
 case "SUPPRESSED": return "Suppressed, not sent";
 case "NOT_SENT": return "Not sent";
 case "COMPLAINED": return "Recipient complaint, needs review";
 case "UNKNOWN": return "Unknown result, verify before retry";
 case "PENDING": return "Pending, delivery unconfirmed";
 }
}
export function recentContextEvidence(items:ContextEvidence[]) {
 const unique=new Map<string,ContextEvidence>();
 for(const item of items){
  const prior=unique.get(item.id);
  if(!prior||(prior.source==="SUBJECT"&&item.source==="EXPLICIT_LINK")) unique.set(item.id,item);
 }
 const sorted=[...unique.values()].sort((a,b)=>b.at.getTime()-a.at.getTime()||a.id.localeCompare(b.id));
 return {entries:sorted.slice(0,25),truncated:sorted.length>25};
}
/** Data access enforces role and exact assigned-job identity before any row read. */
export async function getContextEvidence(kind:ContextKind,id:string){
 const session=await requireRole("OWNER","ADMIN","STAFF");
 const staff=session.user.role==="STAFF";
 if(staff && kind!=="Job") return {entries:[],truncated:false,restricted:true};
 const subject=kind==="Job"
   ?await prisma.job.findFirst({
     where:staff?{id,assignedToUserId:session.user.id}:{id},
     select:{customerId:true},
   })
   :kind==="MaintenanceRequest"
     ?await prisma.maintenanceRequest.findFirst({where:{id},select:{customerId:true}})
     :await prisma.invoice.findFirst({where:{id},select:{customerId:true}});
 if(!subject) return {entries:[],truncated:false,restricted:true};
 const customerId=subject.customerId;
 const [direct,linked]=await Promise.all([
  prisma.messageDelivery.findMany({
   where:{subjectType:kind,subjectId:id},
   orderBy:[{requestedAt:"desc"},{id:"desc"}],take:26,
   select:{id:true,channel:true,state:true,requestedAt:true,
    communicationMessage:{select:{threadId:true}}},
  }),
  prisma.communicationLink.findMany({
   where:{entityType:kind,entityId:id,
    message:{thread:{resolution:"RESOLVED",customerId:customerId??"__not_linked__"}}},
   orderBy:[{createdAt:"desc"},{id:"desc"}],take:26,
   select:{message:{select:{id:true,occurredAt:true,direction:true,
     threadId:true,delivery:{select:{id:true,state:true}}}}},
  }),
 ]);
 const evidence:ContextEvidence[]=[
  ...direct.map(x=>({
   id:"delivery:"+x.id,at:x.requestedAt,channel:x.channel as "EMAIL"|"SMS",
   direction:"OUTBOUND" as const,status:contextStateLabel(x.state),
   href:!staff&&x.communicationMessage?.threadId
     ?"/desk/communications/"+encodeURIComponent(x.communicationMessage.threadId):null,
   source:"SUBJECT" as const,
  })),
  ...linked.map(x=>({
   id:x.message.delivery?"delivery:"+x.message.delivery.id:"message:"+x.message.id,
   at:x.message.occurredAt,channel:"SMS" as const,
   direction:x.message.direction,
   status:x.message.direction==="INBOUND"?"Incoming text recorded":
     x.message.delivery?contextStateLabel(x.message.delivery.state):
       "Outbound delivery unconfirmed",
   href:staff?null:"/desk/communications/"+encodeURIComponent(x.message.threadId),
   source:"EXPLICIT_LINK" as const,
  })),
 ];
 const page=recentContextEvidence(evidence);
 return {...page,truncated:page.truncated||direct.length>25||linked.length>25,
  restricted:false};
}
