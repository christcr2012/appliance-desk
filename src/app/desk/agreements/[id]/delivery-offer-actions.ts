"use server";
import { requireRole } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { saveAgreementDeliveryOffers } from "@/domains/orders/delivery";
export async function setAgreementDeliveryOptionsAction(agreementId:string,
  rows:Array<{date:string;window:"AM"|"PM"}>) {
  const session=await requireRole("OWNER","ADMIN");
  try{
    const version=await saveAgreementDeliveryOffers(session.user.id,agreementId,rows);
    revalidatePath("/desk/agreements/"+agreementId);
    return{ok:true as const,version};
  }catch(error){
    return{ok:false as const,message:error instanceof Error?error.message:"Unable to update."};
  }
}

export async function reviewAgreementDrivingRouteAction(
  agreementId:string,miles:number,sourceReference:string,measuredAt:string,origin:string) {
  const session=await requireRole("OWNER");
  try{
    const {recordDeliveryRouteEvidence}=await import("@/domains/orders/route-evidence");
    const fee=await recordDeliveryRouteEvidence(session.user.id,{agreementId},
      {miles,source:"OWNER_MANUAL_DRIVING_ROUTE",sourceReference,measuredAt,origin});
    revalidatePath("/desk/agreements/"+agreementId);
    return{ok:true as const,feeCents:fee.amountCents,band:fee.band};
  }catch(error){
    return{ok:false as const,message:error instanceof Error?error.message:"Route verification failed."};
  }
}
