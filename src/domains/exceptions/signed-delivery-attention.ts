import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { customerContact, type ExceptionItem } from "./rules";
import { businessDateKey } from "@/lib/business-date";
import { handoffNamesFromLines, pickupHandoffTitle, PICKUP_HANDOFF_DETAIL } from "@/domains/delivery/pickup-handoff";

/** The business day after signing, as a date-only deadline. */
export function dayAfterSigning(signedAt: Date): Date {
 const d = new Date(businessDateKey(signedAt) + "T00:00:00Z");
 d.setUTCDate(d.getUTCDate() + 1);
 return d;
}

/** Each unscheduled real delivery job stays visible until owner sets a date. */
export async function listSignedDeliveryAttention(limit:number,scope?:{customerId?:string}):Promise<{rows:ExceptionItem[];total:number}> {
 await requireRole("OWNER","ADMIN");
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("A bounded delivery task limit is required.");
 const where={
  type:"DELIVERY" as const,status:"SCHEDULED" as const,scheduledAt:null,
  agreement:{is:{status:"ACTIVE" as const,firstDeliveredOn:null,renewedFromAgreementId:null,
   signature:{is:{signedAt:{not:null}}}}},
  ...(scope?.customerId?{customerId:scope.customerId}:{}),
 };
 const jobs=await prisma.job.findMany({where,select:{
  id:true,createdAt:true,customerPickupHandoff:true,
  agreement:{select:{signature:{select:{signedAt:true}},customer:{select:{phone:true,user:{select:{name:true,email:true}}}},
   lines:{select:{label:true,assignments:{where:{unassignedAt:null},
    select:{appliance:{select:{applianceType:{select:{name:true}}}}}}},orderBy:{id:"asc"}}}},
 },orderBy:[{createdAt:"asc"},{id:"asc"}],take:limit});
 return {rows:jobs.map(job=>{
  const name=job.agreement!.customer.user.name??job.agreement!.customer.user.email;
  const href="/desk/jobs/"+encodeURIComponent(job.id);
  // ZONE-1: a customer pickup is a hand-over at our place, never "Schedule delivery".
  const words=job.customerPickupHandoff
   ?{title:pickupHandoffTitle(handoffNamesFromLines(job.agreement!.lines??[]),name),detail:PICKUP_HANDOFF_DETAIL,label:"Open hand-over"}
   :{title:"Schedule "+name+"'s delivery",
     detail:"This rental was signed. A draft delivery visit exists but has no scheduled date. Confirm signing payment status before dispatch.",
     label:"Schedule delivery"};
  return {
  category:"SIGNED_DELIVERY_UNSCHEDULED" as const,severity:"high" as const,
  title:words.title,
  detail:words.detail,
  href,since:job.createdAt,
  ...(job.agreement!.signature?.signedAt?{dueOn:dayAfterSigning(job.agreement!.signature.signedAt),dueDateOnly:true}:{}),
  primaryAction:{href,label:words.label},
  contact:customerContact(job.agreement!.customer),
 };}),total:jobs.length<limit?jobs.length:await prisma.job.count({where})};
}
