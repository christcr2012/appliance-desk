"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  savePreparedMandatoryChargeReview,
} from "@/domains/estimates/mandatory-charge-allocation";
import type { MandatoryLocationChoice } from "@/domains/billing/mandatory-charge-review";

export type MandatoryChargeActionState={success:string;error:string};
const keys=["delivery","installation","removal","damageWaiver"] as const;
export async function saveMandatoryChargeReviewAction(
  _state:MandatoryChargeActionState,form:FormData,
):Promise<MandatoryChargeActionState>{
  const session=await requireRole("OWNER");
  try{
    const estimateId=String(form.get("estimateId")??"");
    const expectedEstimateUpdatedAt=new Date(String(form.get("estimateUpdatedAt")??""));
    const rawRevision=String(form.get("globalRevision")??"");
    if(!/^\d+$/.test(rawRevision))
      throw new Error("The global owner fee policy must first be reviewed.");
    const expectedGlobalPolicyRevision=Number(rawRevision);
    const expectedSettingsUpdatedAt=String(form.get("settingsUpdatedAt")??"");
    const rdfId=String(form.get("rdfAgreementId")??"");
    const ids=form.getAll("agreementId").map(String);
    if(!ids.length||ids.length>500||!estimateId)
      throw new Error("All prepared customer-owned delivery locations are required.");
    const choices:MandatoryLocationChoice[]=ids.map((agreementId,i)=>({
      agreementId,
      decisions:Object.fromEntries(keys.map(kind=>[
        kind,String(form.get(kind+"_"+i)??""),
      ])) as MandatoryLocationChoice["decisions"],
      exceptionReasons:Object.fromEntries(keys.map(kind=>[
        kind,String(form.get(kind+"_reason_"+i)??""),
      ])) as MandatoryLocationChoice["exceptionReasons"],
      retailDeliveryEvent:agreementId===rdfId,
    }));
    const expectedRevisions=ids.map((agreementId,i)=>{
      const revision=String(form.get("revision_"+i)??"");
      if(revision!==""&&!/^[1-9]\d{0,5}$/.test(revision))
        throw new Error("A service charge review version changed. Refresh.");
      return {agreementId,revision:revision===""?null:Number(revision)};
    });
    const result=await savePreparedMandatoryChargeReview({
      actorUserId:session.user.id,estimateId,expectedEstimateUpdatedAt,
      expectedGlobalPolicyRevision,expectedSettingsUpdatedAt,
      expectedRevisions,choices,reason:String(form.get("reason")??""),
    });
    revalidatePath("/desk/estimates/"+estimateId);
    return {success:result.changedAgreementIds.length?
      "Owner service/RDF/tax diagnostics recorded for "+
      result.changedAgreementIds.length+" address(es). Not a payable quote.":
      "No changes to the reviewed service charges.",error:""};
  }catch(error){
    return {success:"",error:error instanceof Error?error.message:
      "Unable to review the required service charges."};
  }
}
