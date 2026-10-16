import { prisma } from "@/lib/prisma";
import { sendCustomerActivationEmail } from "@/domains/leads";

export type OrderFinishStatus = "WAITING" | "SIGN" | "PAYMENT_PENDING" | "READY_FOR_ACCOUNT";
export async function customerOrderFinishStatus(estimateId: string): Promise<OrderFinishStatus> {
  const e=await prisma.estimate.findUnique({where:{id:estimateId},
    select:{status:true,customerId:true,customerAutoFinishEnabled:true,
      createdAgreements:{select:{id:true,customerId:true,status:true,
        signature:{select:{signedAt:true}},
        signingPaymentObligation:{select:{status:true,receiptId:true}}}}}});
  if(!e || !e.customerAutoFinishEnabled || !e.customerId ||
    !["APPROVED","CONVERTED"].includes(e.status))return "WAITING";
  if(e.createdAgreements.length!==1 ||
     e.createdAgreements[0].customerId!==e.customerId)return "WAITING";
  const a=e.createdAgreements[0];
  if(!a.signature?.signedAt)return "SIGN";
  if(a.signingPaymentObligation?.status!=="SETTLED" ||
    !a.signingPaymentObligation.receiptId)return "PAYMENT_PENDING";
  return "READY_FOR_ACCOUNT";
}
/** Existing Better Auth single-use email reset flow is the only supported way
 * for an untrusted bearer-link visitor to establish customer credentials. */
export async function sendSignedCustomerAccountLink(estimateId:string):Promise<boolean> {
  if(await customerOrderFinishStatus(estimateId)!=="READY_FOR_ACCOUNT")return false;
  const e=await prisma.estimate.findUnique({where:{id:estimateId},
    select:{customer:{select:{user:{select:{email:true}}}}}});
  const email=e?.customer?.user?.email;
  if(!email)return false;
  return sendCustomerActivationEmail(email);
}
