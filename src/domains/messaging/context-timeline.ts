import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { Cursor, LinkedTimelineEntry } from "@/domains/customers/timeline-page";

const PAGE_SIZE=25;
type Subject="Customer"|"Lead";
const rank={note:0,activity:1,message:2,call:3} as const;
function before(kind:"message"|"call", cursor:Cursor|null,field:"occurredAt"|"startedAt") {
  if (!cursor) return {};
  const at=new Date(cursor.createdAt);
  const equal=cursor.kind===kind
    ? {[field]:at,id:{lt:cursor.id}}
    : rank[kind]>rank[cursor.kind] ? {[field]:at} : null;
  return {OR:[{[field]:{lt:at}},...(equal?[equal]:[])]};
}
function stateLabel(value:string|null):string {
  switch(value) {
    case "DELIVERED": return "delivered";
    case "ACCEPTED": return "accepted by provider, delivery not confirmed";
    case "FAILED": return "failed";
    case "UNKNOWN": return "unknown delivery status";
    case "NOT_SENT": return "not sent";
    case "SUPPRESSED": return "suppressed and not sent";
    default: return "delivery unconfirmed";
  }
}
/** Only confirmed foreign-key relationships, never phone-number guesses. */
export async function getLinkedCommunicationRows(
  subject:Subject, id:string, cursor:Cursor|null,
):Promise<{messages:LinkedTimelineEntry[];calls:LinkedTimelineEntry[]}> {
  await requireRole("OWNER","ADMIN");
  const relation:Prisma.CommunicationThreadWhereInput={
    resolution:"RESOLVED",...(subject==="Customer"?{customerId:id}:{leadId:id}),
  };
  const [messages,calls]=await Promise.all([
    prisma.communicationMessage.findMany({
      where:{thread:relation,...before("message",cursor,"occurredAt")},
      take:PAGE_SIZE+1,orderBy:[{occurredAt:"desc"},{id:"desc"}],
      select:{id:true,direction:true,occurredAt:true,
        threadId:true,delivery:{select:{state:true}}},
    }),
    prisma.callSession.findMany({
      where:{thread:relation,...before("call",cursor,"startedAt")},
      take:PAGE_SIZE+1,orderBy:[{startedAt:"desc"},{id:"desc"}],
      select:{id:true,direction:true,outcome:true,state:true,startedAt:true,threadId:true},
    }),
  ]);
  return {
    messages:messages.map(m=>({
      id:"message-"+m.id,kind:"message" as const,
      summary:m.direction==="INBOUND"?"Incoming SMS":"Outgoing SMS",
      detail:m.direction==="INBOUND"
        ? "Incoming message recorded; body available only in private inbox."
        : "Text: "+stateLabel(m.delivery?.state??null)+". Acceptance is not delivery.",
      authorName:null,createdAt:m.occurredAt,
      href:"/desk/communications/"+encodeURIComponent(m.threadId),
    })),
    calls:calls.map(c=>({
      id:"call-"+c.id,kind:"call" as const,
      summary:c.direction==="INBOUND"
        ? c.outcome==="MISSED"?"Missed incoming call"
          :c.outcome==="VOICEMAIL"?"Incoming voicemail":"Incoming phone call"
        :"Outgoing phone call",
      detail:c.outcome==="ANSWERED"?"Answered"
        :c.outcome==="MISSED"?"Missed, follow-up may be needed"
        :c.outcome==="VOICEMAIL"?"Voicemail; listen in the private call screen"
        :"Status "+(c.outcome??c.state)+"; not proof of a completed conversation",
      authorName:null,createdAt:c.startedAt,
      href:
        "/desk/communications/calls/"+encodeURIComponent(c.id),
    })),
  };
}
