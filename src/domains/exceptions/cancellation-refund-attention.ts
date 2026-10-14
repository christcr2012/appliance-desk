import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "./rules";
export async function listCancellationRefundAttention(limit: number):Promise<{rows:ExceptionItem[];total:number}> {
 await requireRole("OWNER","ADMIN");
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error("A bounded refund attention limit is required.");
 const where={refundState:"PENDING_EXTERNAL_REFUND"};
 const rows=await prisma.preDeliveryCancellation.findMany({where,
  select:{agreementId:true,refundDueCents:true,approvedAt:true,agreement:{select:{customer:{select:{user:{select:{name:true,email:true}}}}}}},
  orderBy:[{approvedAt:"asc"},{agreementId:"asc"}],take:limit});
 return {rows:rows.map(row=>({
  category:"CANCELLATION_REFUND_DUE",severity:"high",
  title:"Approved cancellation — refund still due: "+(row.agreement.customer.user.name??row.agreement.customer.user.email),
  detail:"An owner approved this before-delivery cancellation. The recorded refund is still owed. Obtain separate money-out authority, verify the original payment and provider outcome, then reconcile before recording it as returned.",
  href:"/desk/agreements/"+encodeURIComponent(row.agreementId),
  amountCents:row.refundDueCents,since:row.approvedAt,
  primaryAction:{href:"/desk/agreements/"+encodeURIComponent(row.agreementId),label:"Reconcile refund"},
 })),total:rows.length<limit?rows.length:await prisma.preDeliveryCancellation.count({where})};
}
