"use server";
import { requireRole } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { saveDeliveryOffers } from "@/domains/orders/delivery";

export async function setEstimateDeliveryOptionsAction(estimateId: string,
  options: Array<{date:string;window:"AM"|"PM"}>) {
  const session = await requireRole("OWNER","ADMIN");
  try {
    const saved = await saveDeliveryOffers(session.user.id,estimateId,options);
    revalidatePath("/desk/estimates/"+estimateId);
    revalidatePath("/estimate/"+estimateId);
    return {ok:true as const,...saved};
  } catch(error) {
    return {ok:false as const,message:error instanceof Error?error.message:"Unable to save options."};
  }
}
