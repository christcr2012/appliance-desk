"use server";
import { headers } from "next/headers";
import { isRateLimited } from "@/lib/rate-limit";
import { sendSignedCustomerAccountLink } from "@/domains/orders/activation";
export async function sendFinishedOrderActivationAction(estimateId:string):
  Promise<{ok:boolean;message:string}> {
  const header=await headers();
  const ip=header.get("x-forwarded-for")?.split(",")[0]??"unknown";
  if(await isRateLimited("w24-account-link:"+ip+":"+estimateId,
      {max:3,windowMs:60*60*1000}))
    return{ok:false,message:"Too many requests. Please try again later."};
  try{
    const accepted=await sendSignedCustomerAccountLink(estimateId);
    return accepted?{ok:true,message:"Account setup link requested. Check the email on your rental account."}:
      {ok:false,message:"Account setup cannot be sent yet. Your agreement or payment may still need review."};
  }catch{
    return{ok:false,message:"Account setup is unavailable right now. Contact the office."};
  }
}
