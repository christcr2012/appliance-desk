"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { dollarsToCents } from "@/domains/pricing";
import { savePreparedCommercialReserveAllocation } from
  "@/domains/estimates/commercial-reserve-allocation";

export type CommercialReserveActionState = {success:string;error:string};

/**
 * Action inputs are expected amount revisions, not trusted agreement/customer
 * identities. The OWNER transaction independently verifies the exact scope.
 */
export async function saveCommercialReserveAction(
  _state:CommercialReserveActionState, form:FormData,
):Promise<CommercialReserveActionState>{
  const session=await requireRole("OWNER");
  try{
    const estimateId=String(form.get("estimateId")??"");
    const updatedAt=new Date(String(form.get("estimateUpdatedAt")??""));
    const reason=String(form.get("reason")??"");
    const ids=form.getAll("agreementId").map(String);
    if(!estimateId||ids.length===0||ids.length>500)
      throw new Error("Choose an eligible commercial estimate with prepared properties.");
    const allocations=ids.map((agreementId,index)=>{
      const raw=String(form.get("amount_"+index)??"");
      if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||raw.length>14)
        throw new Error("Enter each reserve as dollars and no more than two decimal places.");
      const amountCents=dollarsToCents(Number(raw));
      return {agreementId,amountCents,
        replenishment:String(form.get("replenishment_"+index)??"") as "QUARTERLY"|"NONE",
        termsReference:String(form.get("terms_"+index)??""),
      };
    });
    const expectedRevisions=ids.map((agreementId,index)=>{
      const raw=String(form.get("revision_"+index)??"");
      if(raw!==""&&!/^[1-9]\d{0,5}$/.test(raw))
        throw new Error("Reserve review version is invalid; refresh.");
      return {agreementId,revision:raw===""?null:Number(raw)};
    });
    const result=await savePreparedCommercialReserveAllocation({
      actorUserId:session.user.id,estimateId,
      expectedEstimateUpdatedAt:updatedAt,expectedRevisions,allocations,reason,
    });
    revalidatePath("/desk/estimates/"+estimateId);
    revalidatePath("/desk/agreements");
    return {success:result.changedAgreementIds.length
      ? "Owner-only draft reserve policy recorded for "+result.changedAgreementIds.length+
        " location(s). A complete signed quote and counsel review are still required."
      : "No reserve policy changes were necessary.",
      error:""};
  }catch(error){
    return {success:"",error:error instanceof Error?error.message:
      "Unable to save reviewed reserve allocation."};
  }
}
