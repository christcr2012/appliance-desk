"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { recordExternallyReturnedRefund, type RefundReturnMethod } from "@/domains/agreements/pre-delivery-refund-return";
export type RefundReturnActionState={error:string};
export async function recordReturnedRefundAction(
 _state:RefundReturnActionState,form:FormData,
):Promise<RefundReturnActionState>{
 const session=await requireRole("OWNER","ADMIN");
 const agreementId=String(form.get("agreementId")??"");
 try{
  await recordExternallyReturnedRefund({
   actorUserId:session.user.id,agreementId,
   expectedFingerprint:String(form.get("fingerprint")??""),
   method:String(form.get("method")??"") as RefundReturnMethod,
   reference:String(form.get("reference")??""),
   confirmedReturned:form.get("confirmedReturned")==="on",
  });
 }catch(error){
  return {error:error instanceof Error?error.message:"Could not verify the external refund."};
 }
 revalidatePath("/desk/today");
 revalidatePath("/desk/agreements/"+agreementId);
 redirect("/desk/agreements/"+encodeURIComponent(agreementId));
}
