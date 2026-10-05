"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openPrivacyRequest } from "@/domains/privacy";

export async function accountPrivacyRequestAction(formData: FormData): Promise<never> {
  const session = await requireSession();
  if (session.user.role !== "CUSTOMER") redirect("/account/settings/privacy?error=1");
  const customer = await prisma.customer.findUnique({
    where: { userId: session.user.id },
    select: { id: true, user: { select: { email: true } } },
  });
  const kind = formData.get("kind");
  if (!customer || (kind !== "EXPORT" && kind !== "DELETE")) redirect("/account/settings/privacy?error=1");

  await openPrivacyRequest({
    kind,
    email: customer.user.email,
    customerId: customer.id,
    ipKey: `session:${session.user.id}`,
  });
  redirect("/account/settings/privacy?requested=1");
}
