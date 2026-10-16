"use server";
import { requireRole } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { saveDeliveryOffers } from "@/domains/orders/delivery";

export async function setEstimateDeliveryOptionsAction(estimateId: string,
  options: Array<{date:string;window:"AM"|"PM"}>, autoFinish=false) {
  const session = await requireRole("OWNER","ADMIN");
  try {
    const saved = await saveDeliveryOffers(session.user.id,estimateId,options,autoFinish);
    revalidatePath("/desk/estimates/"+estimateId);
    revalidatePath("/estimate/"+estimateId);
    return {ok:true as const,...saved};
  } catch(error) {
    return {ok:false as const,message:error instanceof Error?error.message:"Unable to save options."};
  }
}

export async function reviewEstimateDrivingRouteAction(
  estimateId:string, miles:number,sourceReference:string,measuredAt:string,origin:string) {
  const session=await requireRole("OWNER");
  try {
    const { recordDeliveryRouteEvidence }=await import("@/domains/orders/route-evidence");
    const fee=await recordDeliveryRouteEvidence(session.user.id,{estimateId},
      {miles,source:"OWNER_MANUAL_DRIVING_ROUTE",sourceReference,measuredAt,origin});
    revalidatePath("/desk/estimates/"+estimateId);
    return {ok:true as const,feeCents:fee.amountCents,band:fee.band};
  }catch(error){
    return {ok:false as const,message:error instanceof Error?error.message:"Route verification failed."};
  }
}
export async function verifyDeliveryOriginAction(origin:string,reference:string){
  const session=await requireRole("OWNER");
  try{
    const {setVerifiedDrivingOrigin}=await import("@/domains/orders/route-evidence");
    await setVerifiedDrivingOrigin(session.user.id,origin,reference);
    return{ok:true as const};
  }catch(error){
    return {ok:false as const,message:error instanceof Error?error.message:"Origin not verified."};
  }
}
