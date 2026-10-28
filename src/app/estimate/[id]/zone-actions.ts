"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRateLimited } from "@/lib/rate-limit";

const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

/**
 * ZONE-1: the customer chooses "deliver it" or "I'll pick it up" on their estimate page (the private link). The price
 * comes from the estimate's frozen zone, never from the form. Only while the estimate is waiting for their answer.
 */
export async function chooseDeliveryAction(form: FormData) {
  const estimateId = String(form.get("estimateId") ?? "").slice(0, 64);
  const serviceAddressId = String(form.get("serviceAddressId") ?? "").slice(0, 64);
  const choice = form.get("choice") === "CUSTOMER_PICKUP" ? "CUSTOMER_PICKUP" : "DELIVER";
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? "unknown";
  let result = "saved";
  if (await isRateLimited(`estimate-delivery-choice:${ip}`, RATE_LIMIT)) result = "limited";
  else {
    try {
      const { setEstimateDeliveryChoiceByCustomer } = await import("@/domains/delivery/estimate-zone");
      await setEstimateDeliveryChoiceByCustomer(estimateId, serviceAddressId, choice);
    } catch {
      result = "refused";
    }
  }
  revalidatePath(`/estimate/${estimateId}`);
  redirect(`/estimate/${encodeURIComponent(estimateId)}?delivery=${result}#delivery-choice`);
}
