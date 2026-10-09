"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { resolvePendingRdfRecords } from "@/domains/tax/rdf-records";
import type { TaxActionState } from "../setup/actions";

/** Re-runs the existing idempotent resolver; never charges or contacts a provider. */
export async function retryPendingDeliveryFees(
  _state: TaxActionState, _form: FormData,
): Promise<TaxActionState> {
  void _state; void _form;
  try {
    await requireRole("OWNER", "ADMIN");
    const result = await resolvePendingRdfRecords(new Date(), 200);
    const remaining = await prisma.retailDeliveryFeeRecord.count({
      where: { status: { in: ["PENDING_DECISION", "PENDING_RATE"] } },
    });
    revalidatePath("/desk/sales-tax/delivery-fees");
    revalidatePath("/desk/sales-tax");
    revalidatePath("/desk/today");
    return {
      error: "",
      success: result.resolved + " delivery fee record" +
        (result.resolved === 1 ? "" : "s") + " completed. " +
        remaining + " still waiting for an answer or fee amount.",
    };
  } catch {
    return { error: "Couldn't check the delivery fees. Refresh and try again.", success: "" };
  }
}
