import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "./rules";

/** Each unscheduled real delivery job stays visible until owner sets a date. */
export async function listSignedDeliveryAttention(limit:number):Promise<{rows:ExceptionItem[];total:number}> {
 await requireRole("OWNER","ADMIN");
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("A bounded delivery task limit is required.");
 const where={
  type:"DELIVERY" as const,status:"SCHEDULED" as const,scheduledAt:null,
  agreement:{is:{status:"ACTIVE" as const,firstDeliveredOn:null,renewedFromAgreementId:null,
   signature:{is:{signedAt:{not:null}}}}},
 };
 const jobs=await prisma.job.findMany({where,select:{
  id:true,createdAt:true,
  agreement:{select:{customer:{select:{user:{select:{name:true,email:true}}}}}},
 },orderBy:[{createdAt:"asc"},{id:"asc"}],take:limit});
 return {rows:jobs.map(job=>({
  category:"SIGNED_DELIVERY_UNSCHEDULED",severity:"high",
  title:"Schedule delivery for "+(job.agreement!.customer.user.name??job.agreement!.customer.user.email),
  detail:"This rental was signed. A draft delivery visit exists but has no scheduled date. Confirm signing payment status before dispatch.",
  href:"/desk/jobs/"+encodeURIComponent(job.id),since:job.createdAt,
  primaryAction:{href:"/desk/jobs/"+encodeURIComponent(job.id),label:"Schedule delivery"},
 })),total:jobs.length<limit?jobs.length:await prisma.job.count({where})};
}
