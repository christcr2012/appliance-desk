import "server-only";
import { prisma } from "@/lib/prisma";
import { parseCustomerLanguage } from "./copy";
import { allSpanishSurfacesReady, displayCustomerLanguage } from "./review";
export async function customerMessageLanguage(customerId: string) {
  if (!allSpanishSurfacesReady) return "en";
  const row = await prisma.customer.findUnique({where:{id:customerId},select:{preferredLanguage:true,archivedAt:true}});
  return row && !row.archivedAt ? displayCustomerLanguage(parseCustomerLanguage(row.preferredLanguage)) : "en";
}
