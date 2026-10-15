"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { recordSigningBusinessReview, type SigningBusinessReviewInput } from "@/domains/billing/signing-business-review";
export async function saveSigningBusinessReviewAction(_previous:{message:string;ok:boolean},form:FormData){
  try{
    const session=await requireRole("OWNER");
    const input=Object.fromEntries(["agreementId","expectedOrderFingerprint","decision","effectiveFromKey",
      "confirmedOnKey","taxAdviserReference","legalAdviserReference","termsReference","reason"]
      .map(key=>[key,String(form.get(key)??"")])) as Omit<SigningBusinessReviewInput,"acknowledged">;
    const result=await recordSigningBusinessReview(session.user.id,{...input,acknowledged:form.get("acknowledged")==="on"});
    revalidatePath(`/desk/agreements/${input.agreementId}`);
    revalidatePath("/desk/estimates");
    return {ok:true,message:`Recorded ${result.decision==="APPROVED"?"professional advice clearance":"review-required restriction"} for ${result.agreements} location(s). Independent payment, communication and activation rules still apply.`};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:"Could not record review."};}
}

export async function reopenUnsignedSigningOrderAction(_previous:{message:string;ok:boolean},form:FormData){
 try{
  const session=await requireRole("OWNER");
  const {reopenUnsignedSigningOrder}=await import("@/domains/billing/signing-unsigned-reopen");
  const agreementId=String(form.get("agreementId")??"");
  const result=await reopenUnsignedSigningOrder(session.user.id,{agreementId,expectedOrderFingerprint:String(form.get("expectedOrderFingerprint")??""),reason:String(form.get("reason")??"")});
  revalidatePath(`/desk/agreements/${agreementId}`);revalidatePath("/desk/estimates");
  return {ok:true,message:`Reopened ${result.agreements} unsigned location(s). Prepare and review the new amounts, freeze them, then record new clearance.`};
 }catch(error){return {ok:false,message:error instanceof Error?error.message:"Could not reopen the order."};}
}
