import { prisma } from "@/lib/prisma";
import { CUSTOMER_LANGUAGES, parseCustomerLanguage, type CustomerLanguage } from "./copy";
export * from "./copy";

export async function readCustomerLanguage(userId: string): Promise<CustomerLanguage> {
  const customer = await prisma.customer.findUnique({
    where: { userId },
    select: { preferredLanguage: true },
  });
  return parseCustomerLanguage(customer?.preferredLanguage);
}

/** Customer-scoped update. Never accept an arbitrary customer ID from a form. */
export async function chooseCustomerLanguage(
  authenticatedUserId: string,
  language: CustomerLanguage,
): Promise<boolean> {
  if (!CUSTOMER_LANGUAGES.includes(language)) throw new Error("Unsupported language");
  const claimed = await prisma.customer.updateMany({
    where: { userId: authenticatedUserId },
    data: { preferredLanguage: language },
  });
  return claimed.count === 1;
}
