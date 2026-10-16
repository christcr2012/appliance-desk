"use server";
import {requireRole} from "@/lib/session";
import {revalidatePath} from "next/cache";
import {recordPhoneOrderPreference,sendPhoneOrderToFinish} from
  "@/domains/orders/phone-orders";
import type {DeliverySelection} from "@/domains/orders/delivery";
export async function recordPhoneOrderPreferenceAction(estimateId:string,preferred:DeliverySelection){
  const session=await requireRole("OWNER","ADMIN");
  try {
    const choice=await recordPhoneOrderPreference(session.user.id,estimateId,preferred);
    revalidatePath("/desk/estimates/"+estimateId);
    return {ok:true as const,choice};
  }catch(error){
    return {ok:false as const,message:error instanceof Error?error.message:"Couldn't record preference."};
  }
}
export async function sendPhoneOrderToFinishAction(estimateId:string){
  const session=await requireRole("OWNER","ADMIN");
  try {
    const result=await sendPhoneOrderToFinish(session.user.id,estimateId);
    revalidatePath("/desk/estimates/"+estimateId);
    revalidatePath("/desk/phone-orders");
    return {ok:true as const,emailed:result.delivery.emailed,
      outcome:result.delivery.outcome??"UNKNOWN"};
  }catch(error){
    return {ok:false as const,message:error instanceof Error?error.message:"Phone order isn't ready."};
  }
}

export async function preparePhoneLeadCustomerAction(estimateId:string) {
  const session=await requireRole("OWNER","ADMIN");
  try{
    const {preparePhoneLeadCustomer}=await import("@/domains/orders/phone-orders");
    const customer=await preparePhoneLeadCustomer(session.user.id,estimateId);
    revalidatePath("/desk/estimates/"+estimateId);
    revalidatePath("/desk/phone-orders");
    return{ok:true as const,customerId:customer.customerId};
  }catch(error){
    return{ok:false as const,message:error instanceof Error?
      error.message:"Unable to prepare customer."};
  }
}
