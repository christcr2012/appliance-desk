"use server";

import { prisma } from "@/lib/prisma";
import { getEstimateForApproval } from "@/domains/estimates";

/** The opaque quote link authorizes a choice for this quote only. A forwarded
 * link must not directly change the customer's global account settings. */
export async function chooseQuoteLanguage(
  estimateId: string,
  language: "en" | "es",
): Promise<"en" | "es"> {
  if (language !== "en" && language !== "es") throw new Error("Unsupported language");
  const quote = await getEstimateForApproval(estimateId);
  if (!quote || !["SENT", "VIEWED"].includes(quote.status)) {
    throw new Error("This quote is no longer available");
  }
  const updated = await prisma.estimate.updateMany({
    where: { id: estimateId, status: quote.status },
    data: { preferredLanguage: language },
  });
  if (updated.count !== 1) throw new Error("This quote is no longer available");
  return language;
}
