"use server";
import {requireRole} from "@/lib/session";
import {revalidatePath} from "next/cache";
import {approveW24JobFee} from "@/domains/orders/owner-job-fees";
import {prepareOwnerFeeInvoiceItem,dispatchOwnerFeeInvoiceItem} from "@/domains/orders/provider-job-fees";
export async function approveW24FeeAction(jobId:string,kind:"MISSED_TRIP"|"RELOCATION",
  evidence:string,expectedVersion:number){
  const session=await requireRole("OWNER");
  try{
    const result=await approveW24JobFee(session.user.id,jobId,kind,evidence,expectedVersion);
    revalidatePath("/desk/jobs/"+jobId);
    return{ok:true as const,amountCents:result.amountCents,charged:false};
  }catch(error){return{ok:false as const,
    message:error instanceof Error?error.message:"Unable to review fee."};}
}
export async function queueApprovedW24FeeAction(jobId:string,kind:"MISSED_TRIP"|"RELOCATION"){
  const session=await requireRole("OWNER");
  try{
    const reserved=await prepareOwnerFeeInvoiceItem(session.user.id,jobId,kind);
    if(reserved.status==="OFF")return{ok:false as const,
      message:"Financial posting stays OFF until separate approved TEST provider and fee-tax policy gates."};
    if(reserved.status==="ALREADY_SENT")return{ok:true as const,
      message:"This exact job fee has already been queued. No duplicate sent."};
    if(!reserved.operationId)throw new Error("Missing immutable provider intent.");
    await dispatchOwnerFeeInvoiceItem(reserved.operationId);
    revalidatePath("/desk/jobs/"+jobId);
    return{ok:true as const,message:"Provider operation submitted; verify provider receipt and NEXT invoice."};
  }catch(error){return{ok:false as const,
    message:error instanceof Error?error.message:"Provider fee requires owner reconciliation."};}
}
